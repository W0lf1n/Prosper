/**
 * Upozornění — what the phone says on its own, and when.
 *
 * Three notices, each off until it is turned on (`TRIMMING-AND-TRAINING.md`
 * R3: a finance app that nags without being asked gets uninstalled):
 *
 * - **Večerní kontrola** — at a time he chooses, the day's one question: is
 *   everything written? It states what today holds and opens the keypad. It
 *   never asks for a tap to confirm an empty day — an empty day is a day
 *   nothing was spent on (2026-08-28), and a forgotten one is fixed by typing
 *   the row with its date.
 * - **Automatická platba** — a standing order set to `auto` fell due. The
 *   row is written by the app on its next launch (`RECURRING.md` §2); the
 *   notice says the money went, and that it will be recorded without him.
 * - **Čeká na potvrzení** — a standing order set to `confirm` fell due and
 *   sits on Domů waiting for its tap.
 *
 * Every notice is said once. `NoticeLog` is the watermark: the day the evening
 * question was last asked, and every `schedule:month` already announced —
 * the same idempotence `Schedule.lastPostedMonth` gives the posting itself,
 * so a phone woken four times on the 15th says "hypotéka" once.
 *
 * This module decides *what* is due at a given minute. *How* it reaches the
 * phone — a push from the sync server, a periodic background sync, a timer in
 * an open tab — is `lib/notify/`, and all three ask this same function, so no
 * two of them can disagree about whether today has been asked about.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { MAX_WAKES } from '@prosper/contracts';
import { isMove } from './accounts';
import { RECORDS, counted } from './czech';
import { addDays, formatDayHeading, monthKey, shiftMonth, type IsoDate } from './datetime';
import { ZERO, add, formatMoney, type Minor } from './money';
import { dueDate, dueSchedules, type DueItem } from './recurring';
import type { Account, Schedule, Txn } from './types';

export type NoticeKind = 'evening' | 'auto' | 'awaiting';

export interface NoticePrefs {
	/** Večerní kontrola: the day's question. */
	evening: boolean;
	/** When it is asked, `HH:MM`, local. */
	eveningAt: string;
	/** A standing order on `auto` fell due. */
	auto: boolean;
	/** A standing order on `confirm` is waiting for its tap. */
	awaiting: boolean;
	/** When on the due day the two payment notices come, `HH:MM`, local. */
	paymentsAt: string;
}

/**
 * Everything off. 21:00 is the hour R3 proposed (Q32) and the one the
 * evening field opens on; 9:00 is the morning of a due day, when the bank
 * has moved the money and the day is still ahead.
 */
export const DEFAULT_NOTICE_PREFS: NoticePrefs = {
	evening: false,
	eveningAt: '21:00',
	auto: false,
	awaiting: false,
	paymentsAt: '09:00'
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:MM` on the 24-hour clock — what `<input type="time">` hands back. */
export function isClockTime(value: unknown): value is string {
	return typeof value === 'string' && CLOCK.test(value);
}

/** Minutes past midnight of a `HH:MM`. */
export function minutesOf(clock: string): number {
	const match = CLOCK.exec(clock);
	if (!match) throw new RangeError(`minutesOf: not a clock time: ${clock}`);
	return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes past local midnight of an instant. */
export function minuteOfDay(date: Date): number {
	return date.getHours() * 60 + date.getMinutes();
}

/**
 * The stored preference, read tolerantly. A field that is missing or not the
 * right shape is the default — a build that adds a fourth notice must not
 * turn the first three off on a phone that saved them before it existed.
 */
export function readNoticePrefs(stored: unknown): NoticePrefs {
	const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
	const flag = (key: 'evening' | 'auto' | 'awaiting') =>
		typeof raw[key] === 'boolean' ? (raw[key] as boolean) : DEFAULT_NOTICE_PREFS[key];
	return {
		evening: flag('evening'),
		eveningAt: isClockTime(raw.eveningAt) ? raw.eveningAt : DEFAULT_NOTICE_PREFS.eveningAt,
		auto: flag('auto'),
		awaiting: flag('awaiting'),
		paymentsAt: isClockTime(raw.paymentsAt) ? raw.paymentsAt : DEFAULT_NOTICE_PREFS.paymentsAt
	};
}

/** Whether anything at all is turned on — what decides if a channel is kept open. */
export function anyNoticeOn(prefs: NoticePrefs): boolean {
	return prefs.evening || prefs.auto || prefs.awaiting;
}

/** "Večer ve 21:00 · platby" — the hub's one line about this room. */
export function noticeSummary(prefs: NoticePrefs): string {
	const parts: string[] = [];
	if (prefs.evening) parts.push(`Večer v ${prefs.eveningAt.replace(/^0/, '')}`);
	if (prefs.auto || prefs.awaiting) parts.push(parts.length ? 'platby' : 'Platby');
	return parts.length ? parts.join(' · ') : 'Vypnuto';
}

// ── the log ─────────────────────────────────────────────────────────────────

export interface NoticeLog {
	/** The day the evening question was last asked. */
	evening: IsoDate | null;
	/** `scheduleId:YYYY-MM` of every payment instance already announced. */
	payments: string[];
}

export const EMPTY_NOTICE_LOG: NoticeLog = { evening: null, payments: [] };

export function readNoticeLog(stored: unknown): NoticeLog {
	const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
	return {
		evening: typeof raw.evening === 'string' ? raw.evening : null,
		payments: Array.isArray(raw.payments)
			? raw.payments.filter((key): key is string => typeof key === 'string')
			: []
	};
}

/** The key a payment instance is remembered by. */
export function paymentKey(scheduleId: string, month: string): string {
	return `${scheduleId}:${month}`;
}

/**
 * How far back a payment is still news. A phone that was off for a fortnight
 * comes back to the dues on Domů, not to a fortnight of notices.
 */
export const PAYMENT_NEWS_DAYS = 7;

/**
 * Keys older than two months can never be due again inside the news window,
 * so the log stays the size of a month's standing orders rather than growing
 * for ever.
 */
function pruned(keys: Iterable<string>, today: IsoDate): string[] {
	const floor = shiftMonth(monthKey(today), -2);
	return [...new Set(keys)].filter((key) => (key.split(':')[1] ?? '') >= floor).sort();
}

/** The log once these instances are told — used by the launch catch-up too. */
export function withPaymentsLogged(
	log: NoticeLog,
	keys: readonly string[],
	today: IsoDate
): NoticeLog {
	return { ...log, payments: pruned([...log.payments, ...keys], today) };
}

// ── what is due ─────────────────────────────────────────────────────────────

export interface Notice {
	kind: NoticeKind;
	/**
	 * The system's own de-duplication: a second notice with the same tag
	 * replaces the first rather than stacking under it. Two channels racing to
	 * the same minute therefore show one notice, not two.
	 */
	tag: string;
	title: string;
	body: string;
	/** Where a tap on it goes. */
	url: '/' | '/zapis' | '/vypis';
}

export interface NoticeInput {
	prefs: NoticePrefs;
	log: NoticeLog;
	today: IsoDate;
	/** Minutes past local midnight, now. */
	minute: number;
	/** Every row; tombstones are ignored here. */
	txns: readonly Txn[];
	schedules: readonly Schedule[];
	accounts: readonly Account[];
}

export interface NoticePlan {
	notices: Notice[];
	/** The log with everything in `notices` recorded. Write it back. */
	log: NoticeLog;
}

/**
 * Everything due to be said at this minute, and the log that says it was.
 *
 * The evening question is due once its minute has passed and it has not been
 * asked today. A payment is due on its day once the payments minute has
 * passed — or at any minute for an instance from an earlier day still inside
 * the news window — and only once. Payments of one mode travel as one notice,
 * so three standing orders on the 1st are one buzz, not three.
 */
export function dueNotices(input: NoticeInput): NoticePlan {
	const { prefs, today, minute } = input;
	const notices: Notice[] = [];
	let log = input.log;

	if (prefs.evening && minute >= minutesOf(prefs.eveningAt) && log.evening !== today) {
		notices.push(eveningNotice(input.txns, input.accounts, today));
		log = { ...log, evening: today };
	}

	if (prefs.auto || prefs.awaiting) {
		const told = new Set(log.payments);
		const oldest = addDays(today, -(PAYMENT_NEWS_DAYS - 1));
		const fresh = dueSchedules({ schedules: input.schedules, today }).filter(
			(item) =>
				item.date >= oldest &&
				(item.date < today || minute >= minutesOf(prefs.paymentsAt)) &&
				!told.has(paymentKey(item.schedule.id, item.month))
		);

		const auto = prefs.auto ? fresh.filter((item) => item.schedule.mode === 'auto') : [];
		const awaiting = prefs.awaiting ? fresh.filter((item) => item.schedule.mode === 'confirm') : [];

		if (auto.length > 0) notices.push(autoNotice(paymentLines(auto, input.accounts), today));
		if (awaiting.length > 0) {
			notices.push(awaitingNotice(paymentLines(awaiting, input.accounts), today));
		}

		const keys = [...auto, ...awaiting].map((item) => paymentKey(item.schedule.id, item.month));
		if (keys.length > 0) log = withPaymentsLogged(log, keys, today);
	}

	return { notices, log };
}

function paymentLines(items: readonly DueItem[], accounts: readonly Account[]): PaymentLine[] {
	return items.map((item) => ({
		payee: item.schedule.payee || 'platba',
		amount: item.schedule.amount,
		code: codeOf(item.schedule.accountId, accounts),
		date: item.date
	}));
}

function codeOf(accountId: string | undefined, accounts: readonly Account[]): string {
	const own = accounts.find((a) => a.id === accountId);
	if (own) return own.currency;
	// A schedule from before accounts were plural posts to the active account,
	// which was the only one — the first live account stands in for it.
	return accounts.find((a) => !a.isDeleted)?.currency ?? 'CZK';
}

/**
 * "Dnes 3 záznamy, utraceno 1 240,00 Kč. Chybí něco?" — or, with nothing
 * written, R3's own line. Spending is summed only while it is all in one
 * currency; koruny and euros are never added (Q49).
 */
export function eveningNotice(
	txns: readonly Txn[],
	accounts: readonly Account[],
	today: IsoDate
): Notice {
	const rows = txns.filter((t) => !t.isDeleted && t.date === today);
	const base = { kind: 'evening' as const, tag: 'prosper-evening', url: '/zapis' as const };
	if (rows.length === 0) {
		return { ...base, title: 'Máš dnešek zapsaný?', body: 'Dnešek je zatím prázdný.' };
	}

	const spent = rows.filter((t) => t.amount < 0 && !isMove(t));
	const codes = new Set(spent.map((t) => codeOf(t.accountId, accounts)));
	let line = `Dnes ${counted(rows.length, RECORDS)}`;
	if (spent.length > 0 && codes.size === 1) {
		const total = spent.reduce((sum: Minor, t) => add(sum, t.amount), ZERO);
		line += `, utraceno ${formatMoney(total, { sign: 'never', code: [...codes][0] })}`;
	}
	return { ...base, title: 'Máš dnešek zapsaný?', body: `${line}. Chybí něco?` };
}

interface PaymentLine {
	payee: string;
	amount: Minor;
	code: string;
	date: IsoDate;
}

/** At most three named, then "a 2 další" — a notice is read in one glance. */
function listed(lines: readonly PaymentLine[]): string {
	const named = lines
		.slice(0, 3)
		.map((l) => `${l.payee} ${formatMoney(l.amount, { sign: 'always', code: l.code })}`);
	const rest = lines.length - named.length;
	return rest > 0 ? `${named.join(', ')} a ${rest} další` : named.join(', ');
}

function when(date: IsoDate, today: IsoDate): string {
	return formatDayHeading(date, today);
}

export function autoNotice(lines: readonly PaymentLine[], today: IsoDate): Notice {
	const base = { kind: 'auto' as const, tag: 'prosper-auto', url: '/vypis' as const };
	if (lines.length === 1) {
		const [line] = lines;
		return {
			...base,
			title: 'Proběhla automatická platba',
			body: `${listed(lines)} · ${when(line!.date, today)}. Do výpisu se zapíše sama.`
		};
	}
	return {
		...base,
		title: 'Proběhly automatické platby',
		body: `${listed(lines)}. Do výpisu se zapíšou samy.`
	};
}

export function awaitingNotice(lines: readonly PaymentLine[], today: IsoDate): Notice {
	const base = { kind: 'awaiting' as const, tag: 'prosper-awaiting', url: '/' as const };
	if (lines.length === 1) {
		const [line] = lines;
		return {
			...base,
			title: 'Platba čeká na potvrzení',
			body: `${listed(lines)} · ${when(line!.date, today)}. Potvrdíš ji na Domů jedním ťuknutím.`
		};
	}
	return {
		...base,
		title: 'Platby čekají na potvrzení',
		body: `${listed(lines)}. Potvrdíš je na Domů.`
	};
}

/**
 * The launch wrote `auto` rows (`catchUpSchedules`): said in the app, once,
 * as what already happened — the notice for the same instance is then never
 * sent, because the launch logs it (`notePaymentsTold`).
 */
export function postedNotice(
	items: readonly DueItem[],
	accounts: readonly Account[]
): Notice | null {
	if (items.length === 0) return null;
	return {
		kind: 'auto',
		tag: 'prosper-posted',
		title: 'Zapsáno automaticky',
		body: listed(paymentLines(items, accounts)),
		url: '/vypis'
	};
}

/**
 * Milliseconds from `now` to the next minute anything could fall due — the
 * evening, or the payments hour — for a timer in an open tab. Null when
 * nothing is on. A second past the minute, so the check lands inside it.
 */
export function msUntilNextCheck(prefs: NoticePrefs, now: Date): number | null {
	const minutes: number[] = [];
	if (prefs.evening) minutes.push(minutesOf(prefs.eveningAt));
	if (prefs.auto || prefs.awaiting) minutes.push(minutesOf(prefs.paymentsAt));
	if (minutes.length === 0) return null;

	const current = minuteOfDay(now);
	const next = Math.min(...minutes.map((m) => (m > current ? m : m + 24 * 60)));
	const target = new Date(now);
	target.setHours(0, next, 1, 0);
	return target.getTime() - now.getTime();
}

// ── the wake plan ───────────────────────────────────────────────────────────

/**
 * When the sync server should wake this phone (`lib/notify/push.ts`).
 *
 * The server never reads the ledger to decide — it is storage and a merge
 * point, not an authority on what a row means (`apps/api/README.md`) — and
 * it does not keep a time zone either. The phone hands it a list of local
 * instants, which `push.ts` turns into UTC with the browser's own rules, so a
 * change to summer time is the phone's arithmetic, not the server's: every
 * evening for the next two months at the chosen minute, and the morning of
 * each due day it can see coming. A wake with nothing to say is a buzz with
 * nothing in it, which is why a due day already settled is left out.
 */

/** How far ahead the wakes reach. A launch refreshes them; two silent months end them. */
export const WAKE_HORIZON_DAYS = 60;

/** And how many — the server refuses a longer list. */
export { MAX_WAKES };

/** Local `YYYY-MM-DDTHH:MM`, ascending, from today on — today's past minutes included. */
export function wakeTimes(
	prefs: NoticePrefs,
	schedules: readonly Schedule[],
	today: IsoDate
): string[] {
	const wakes = new Set<string>();
	const last = addDays(today, WAKE_HORIZON_DAYS - 1);

	if (prefs.evening) {
		for (let day = 0; day < WAKE_HORIZON_DAYS; day += 1) {
			wakes.add(`${addDays(today, day)}T${prefs.eveningAt}`);
		}
	}

	if (prefs.auto || prefs.awaiting) {
		for (const schedule of schedules) {
			if (schedule.isDeleted || schedule.isArchived) continue;
			if (schedule.mode === 'auto' ? !prefs.auto : !prefs.awaiting) continue;

			for (let step = 0; step <= 2; step += 1) {
				const month = shiftMonth(monthKey(today), step);
				if (month < schedule.startMonth) continue;
				if (schedule.endMonth && month > schedule.endMonth) break;
				// Already posted or skipped: nothing to say on that day.
				if (schedule.lastPostedMonth && month <= schedule.lastPostedMonth) continue;
				const date = dueDate(month, schedule.dayOfMonth);
				if (date >= today && date <= last) wakes.add(`${date}T${prefs.paymentsAt}`);
			}
		}
	}

	return [...wakes].sort().slice(0, MAX_WAKES);
}
