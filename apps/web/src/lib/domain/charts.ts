/**
 * The charts on Domů — what each one draws, decided here so a chart
 * component only ever draws (§11.6). `docs/CHARTS.md` is the design; this is
 * the arithmetic under it.
 *
 * - **Kalendář útraty** — the month as a calendar, each day shaded by what it
 *   cost (Tracking: the days are the record; Trimming: the heavy ones show).
 * - **Tempo útraty** — spending so far this month against last month by the
 *   same day (Trimming, and Training: the comparison that changes behaviour
 *   while there is still month left to change it in).
 * - **Vývoj zůstatku** — the balance over a day, a week, a month, a year, or
 *   everything (Targeting: where it is heading, not only where it is).
 *
 * The 10/10/10/70 bars live with the split, in `prosperity.ts`.
 *
 * Three rules every function here keeps, because the screens they sit beside
 * already keep them: spending is `checks.ts`'s `spendingRows` and nothing
 * else, so a chart cannot disagree with the month slab; a move between his
 * own accounts is never spending (Q83); and amounts in two currencies are
 * never added — every function takes the rows of one currency (Q49).
 *
 * Pure. No Dexie, no fetch, no DOM.
 */

import { openingTotal } from './accounts';
import { measurable, spendingRows } from './checks';
import {
	addDays,
	daysBetween,
	daysInMonth,
	fromIsoDate,
	monthKey,
	shiftMonth,
	type IsoDate
} from './datetime';
import { ZERO, add, minor, neg, sub, sum, type Minor } from './money';
import type { Account, Category, Txn } from './types';

// ── shared ──────────────────────────────────────────────────────────────────

/** Positive magnitude spent per day, refunds netted, for the given rows. */
function spentByDay(txns: readonly Txn[], categories: readonly Category[]): Map<IsoDate, Minor> {
	const days = new Map<IsoDate, Minor>();
	for (const row of spendingRows(measurable(txns), categories)) {
		days.set(row.date, add(days.get(row.date) ?? ZERO, neg(row.amount)));
	}
	return days;
}

function countByDay(txns: readonly Txn[], categories: readonly Category[]): Map<IsoDate, number> {
	const counts = new Map<IsoDate, number>();
	for (const row of spendingRows(measurable(txns), categories)) {
		if (row.amount < 0) counts.set(row.date, (counts.get(row.date) ?? 0) + 1);
	}
	return counts;
}

// ── Kalendář útraty ─────────────────────────────────────────────────────────

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export interface CalendarDay {
	date: IsoDate;
	/** 1–31. */
	day: number;
	/** What the day cost, refunds netted. Zero on a day that cost nothing. */
	spent: Minor;
	/** Outflow rows on the day. */
	count: number;
	/**
	 * 0 for a day that cost nothing; 1–4 the quartile of this month's own
	 * spending days. Quartiles rather than a share of the most expensive day,
	 * because rent would otherwise wash every other day out to the same pale.
	 */
	level: HeatLevel;
	isToday: boolean;
	isFuture: boolean;
}

export interface SpendCalendar {
	month: string;
	/** Weeks, Monday first. Null pads the days before the 1st and after the last. */
	weeks: (CalendarDay | null)[][];
	/** The month so far, refunds netted. */
	total: Minor;
	/** The most expensive day so far, or null in a month that has cost nothing. */
	peak: CalendarDay | null;
	/** Days up to today that cost nothing. */
	quiet: number;
	/** Days up to today. */
	elapsed: number;
}

export interface CalendarInput {
	/** One currency's rows (Q49). */
	txns: readonly Txn[];
	categories: readonly Category[];
	month: string;
	today: IsoDate;
}

export function spendCalendar({ txns, categories, month, today }: CalendarInput): SpendCalendar {
	const spent = spentByDay(txns, categories);
	const counts = countByDay(txns, categories);
	const length = daysInMonth(month);

	const days: CalendarDay[] = [];
	for (let day = 1; day <= length; day += 1) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const cost = spent.get(date) ?? ZERO;
		days.push({
			date,
			day,
			spent: cost > 0 ? cost : ZERO,
			count: counts.get(date) ?? 0,
			level: 0,
			isToday: date === today,
			isFuture: date > today
		});
	}

	// Quartiles of the days that cost something, ranked by value so equal
	// days share a level.
	const past = days.filter((d) => !d.isFuture);
	const costly = past.filter((d) => d.spent > 0).map((d) => d.spent as number);
	const sorted = [...costly].sort((a, b) => a - b);
	for (const day of past) {
		if (day.spent <= 0) continue;
		const rank = sorted.findIndex((v) => v === day.spent) + 1;
		day.level = Math.min(4, Math.max(1, Math.ceil((4 * rank) / sorted.length))) as HeatLevel;
	}

	// Monday first: getDay() is 0 for Sunday.
	const lead = (fromIsoDate(`${month}-01`).getDay() + 6) % 7;
	const cells: (CalendarDay | null)[] = [...Array<null>(lead).fill(null), ...days];
	while (cells.length % 7 !== 0) cells.push(null);
	const weeks: (CalendarDay | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

	const peak = past.reduce<CalendarDay | null>(
		(best, d) => (d.spent > 0 && (!best || d.spent > best.spent) ? d : best),
		null
	);

	return {
		month,
		weeks,
		total: sum(past.map((d) => d.spent)),
		peak,
		quiet: past.filter((d) => d.spent <= 0).length,
		elapsed: past.length
	};
}

// ── Tempo útraty ────────────────────────────────────────────────────────────

export interface PacePoint {
	/** Day of the month, 1-based. */
	day: number;
	/** Spent from the 1st to the end of this day, refunds netted. */
	total: Minor;
}

export interface SpendPace {
	month: string;
	/** This month, the 1st to today. */
	current: PacePoint[];
	/** The month before, every day of it. Empty when it has no rows at all. */
	previous: PacePoint[];
	/** The longer of the two months — the x axis. */
	days: number;
	/** Today's day of the month. */
	today: number;
	/**
	 * This month so far minus the month before by the same day — the 18th
	 * against the 18th, or its last day when it was shorter. Positive means
	 * spending faster. Null when there is no month before to compare with.
	 */
	delta: Minor | null;
}

export interface PaceInput {
	txns: readonly Txn[];
	categories: readonly Category[];
	month: string;
	today: IsoDate;
}

function cumulative(spent: Map<IsoDate, Minor>, month: string, upTo: number): PacePoint[] {
	const points: PacePoint[] = [];
	let running = ZERO;
	for (let day = 1; day <= upTo; day += 1) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		running = add(running, spent.get(date) ?? ZERO);
		points.push({ day, total: running });
	}
	return points;
}

export function spendPace({ txns, categories, month, today }: PaceInput): SpendPace {
	const spent = spentByDay(txns, categories);
	const last = shiftMonth(month, -1);
	const thisLength = daysInMonth(month);
	const lastLength = daysInMonth(last);
	const todayDay = monthKey(today) === month ? Number(today.slice(8, 10)) : thisLength;

	const current = cumulative(spent, month, todayDay);
	const hadLast = txns.some((t) => !t.isDeleted && monthKey(t.date) === last);
	const previous = hadLast ? cumulative(spent, last, lastLength) : [];

	const sameDay = previous[Math.min(todayDay, lastLength) - 1];
	const now = current[current.length - 1]?.total ?? ZERO;

	return {
		month,
		current,
		previous,
		days: Math.max(thisLength, previous.length),
		today: todayDay,
		delta: sameDay ? sub(now, sameDay.total) : null
	};
}

// ── Vývoj zůstatku ──────────────────────────────────────────────────────────

/** What the balance line can be drawn for: a currency's accounts together, or one. */
export interface BalanceScope {
	currency: string;
	/** Null for every account in the currency. */
	accountId: string | null;
	label: string;
}

/**
 * The scopes the chart steps through, starting at `currency`: each currency
 * as a whole where it has two accounts or more, then each account in it —
 * never two currencies in one line (Q49).
 */
export function balanceScopes(accounts: readonly Account[], currency: string): BalanceScope[] {
	const live = accounts.filter((a) => !a.isDeleted && !a.isArchived);
	const codes = [...new Set(live.map((a) => a.currency))].sort((a, b) =>
		a === currency ? -1 : b === currency ? 1 : 0
	);
	const scopes: BalanceScope[] = [];
	for (const code of codes) {
		const own = live.filter((a) => a.currency === code).sort((a, b) => a.sortOrder - b.sortOrder);
		if (own.length > 1) scopes.push({ currency: code, accountId: null, label: `Vše · ${code}` });
		for (const account of own) {
			scopes.push({ currency: code, accountId: account.id, label: account.name });
		}
	}
	return scopes.length > 0 ? scopes : [{ currency, accountId: null, label: currency }];
}

export type BalanceRange = 'day' | 'week' | 'month' | 'year' | 'max';

export const BALANCE_RANGES: readonly BalanceRange[] = ['day', 'week', 'month', 'year', 'max'];

/** The segmented pill's words: a trading app's 1D · 1W · 1M · 1Y · MAX, in Czech. */
export const RANGE_LABEL: Record<BalanceRange, string> = {
	day: 'Den',
	week: 'Týden',
	month: 'Měsíc',
	year: 'Rok',
	max: 'Vše'
};

/** What a change is measured over, for the line under the figure. */
export const RANGE_SINCE: Record<BalanceRange, string> = {
	day: 'dnes',
	week: 'za týden',
	month: 'za měsíc',
	year: 'za rok',
	max: 'od začátku'
};

export interface BalancePoint {
	/** The day — or, on the day range, the moment a row was written. */
	at: string;
	value: Minor;
}

export interface BalanceSeries {
	range: BalanceRange;
	points: BalancePoint[];
	first: Minor;
	last: Minor;
	/** `last - first`: what the range did to the balance. */
	change: Minor;
	/**
	 * The ledger is younger than the range, so the line starts at its first
	 * day rather than drawing months of nothing before it existed — and "za
	 * rok" would be a claim about a year nobody recorded.
	 */
	clamped: boolean;
	low: Minor;
	high: Minor;
}

export interface BalanceInput {
	/** Every account; the ones in `currency` are read, live or archived. */
	accounts: readonly Account[];
	/** Every row; tombstones are skipped here. */
	txns: readonly Txn[];
	currency: string;
	/** One account of the currency only; null or absent reads all of them. */
	accountId?: string | null;
	range: BalanceRange;
	today: IsoDate;
}

/** Past this many days, the full range is drawn a week at a time. */
const MAX_DAILY_POINTS = 400;

/**
 * The balance of one currency's accounts, as it stood at the end of each
 * day in the range — or after each row of today, on the day range. Moves
 * between two accounts of the currency cancel out, as they should: the
 * money did not go anywhere. An account counts from its opening day, so a
 * card added in September does not lift August.
 */
export function balanceSeries({
	accounts,
	txns,
	currency,
	accountId = null,
	range,
	today
}: BalanceInput): BalanceSeries {
	const own = accounts.filter(
		(a) => !a.isDeleted && a.currency === currency && (accountId === null || a.id === accountId)
	);
	const ids = new Set(own.map((a) => a.id));
	const rows = txns.filter((t) => !t.isDeleted && ids.has(t.accountId));

	const deltas = new Map<IsoDate, Minor>();
	const bump = (date: IsoDate, amount: Minor) =>
		deltas.set(date, add(deltas.get(date) ?? ZERO, amount));
	for (const account of own) bump(account.openingDate, openingTotal(account));
	for (const row of rows) bump(row.date, row.amount);

	const dates = [...deltas.keys()].sort();
	const closingOn = (date: IsoDate): Minor =>
		sum(dates.filter((d) => d <= date).map((d) => deltas.get(d)!));

	let points: BalancePoint[];
	let clamped = false;
	if (range === 'day') {
		const start = closingOn(addDays(today, -1));
		const todays = rows
			.filter((t) => t.date === today)
			.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
		const openedToday = sum(own.filter((a) => a.openingDate === today).map(openingTotal));
		let running = add(start, openedToday);
		points = [{ at: `${today}T00:00`, value: running }];
		for (const row of todays) {
			running = add(running, row.amount);
			points.push({ at: row.createdAt, value: running });
		}
		if (points.length === 1) points.push({ at: `${today}T23:59`, value: running });
	} else {
		const span =
			range === 'week'
				? 7
				: range === 'month'
					? 30
					: range === 'year'
						? 365
						: Math.max(1, daysBetween(dates[0] ?? today, today));
		const step = span > MAX_DAILY_POINTS ? 7 : 1;
		const earliest = dates[0] ?? today;
		const wanted = addDays(today, -span);
		clamped = range !== 'max' && wanted < earliest;
		const from = clamped ? earliest : wanted;

		// One pass: a running balance carried day by day from the start.
		let running = closingOn(from);
		points = [{ at: from, value: running }];
		let day = from;
		let sinceLast = 0;
		while (day < today) {
			day = addDays(day, 1);
			running = add(running, deltas.get(day) ?? ZERO);
			sinceLast += 1;
			if (sinceLast === step || day === today) {
				points.push({ at: day, value: running });
				sinceLast = 0;
			}
		}
	}

	// A ledger begun today has one day to draw; a line needs two ends.
	if (points.length === 1) points.push({ at: today, value: points[0]!.value });

	const values = points.map((p) => p.value as number);
	const first = points[0]!.value;
	const last = points[points.length - 1]!.value;
	return {
		range,
		points,
		first,
		last,
		change: sub(last, first),
		clamped,
		low: minor(Math.min(...values)),
		high: minor(Math.max(...values))
	};
}
