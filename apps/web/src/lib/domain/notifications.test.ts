import { describe, expect, it } from 'vitest';
import {
	DEFAULT_NOTICE_PREFS,
	EMPTY_NOTICE_LOG,
	MAX_WAKES,
	WAKE_HORIZON_DAYS,
	dueNotices,
	eveningNotice,
	isClockTime,
	minutesOf,
	msUntilNextCheck,
	noticeSummary,
	paymentKey,
	postedNotice,
	readNoticeLog,
	readNoticePrefs,
	wakeTimes,
	withPaymentsLogged,
	type NoticeInput,
	type NoticePrefs
} from './notifications';
import { minor } from './money';
import type { Account, Schedule, Txn } from './types';

const SYNCED = { updatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };
const TODAY = '2026-10-15';

function account(id: string, currency = 'CZK'): Account {
	return {
		id,
		name: id,
		kind: 'checking',
		openingBalance: minor(0),
		openingDate: '2026-01-01',
		pockets: [],
		currency,
		isArchived: false,
		sortOrder: 0,
		...SYNCED
	};
}

let seq = 0;
function txn(amount: number, extra: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `txn-${seq}`,
		accountId: 'kb',
		date: TODAY,
		amount: minor(amount),
		categoryId: 'cat',
		payee: 'oběd',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		isProvisional: false,
		shares: [],
		scheduleId: null,
		createdAt: `${TODAY}T10:00:00.000Z`,
		...SYNCED,
		...extra
	};
}

function schedule(id: string, patch: Partial<Schedule> = {}): Schedule {
	return {
		id,
		accountId: 'kb',
		payee: id,
		categoryId: 'cat',
		amount: minor(-379_00),
		dayOfMonth: 15,
		startMonth: '2026-01',
		endMonth: null,
		mode: 'confirm',
		shares: [],
		lastPostedMonth: '2026-09',
		isArchived: false,
		sortOrder: 0,
		...SYNCED,
		...patch
	};
}

/** Intl's spaces are non-breaking and its minus may be typographic; tests read plain text. */
function plain(text: string): string {
	return text.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-');
}

const ALL_ON: NoticePrefs = { ...DEFAULT_NOTICE_PREFS, evening: true, auto: true, awaiting: true };

function input(patch: Partial<NoticeInput> = {}): NoticeInput {
	return {
		prefs: ALL_ON,
		log: EMPTY_NOTICE_LOG,
		today: TODAY,
		minute: minutesOf('21:30'),
		txns: [],
		schedules: [],
		accounts: [account('kb')],
		...patch
	};
}

describe('clock times', () => {
	it('accepts what a time input hands back, and nothing else', () => {
		expect(isClockTime('21:00')).toBe(true);
		expect(isClockTime('00:00')).toBe(true);
		expect(isClockTime('23:59')).toBe(true);
		expect(isClockTime('24:00')).toBe(false);
		expect(isClockTime('9:00')).toBe(false);
		expect(isClockTime(2100)).toBe(false);
	});

	it('counts minutes past midnight', () => {
		expect(minutesOf('00:00')).toBe(0);
		expect(minutesOf('21:30')).toBe(21 * 60 + 30);
		expect(() => minutesOf('25:00')).toThrow(RangeError);
	});
});

describe('the stored preference', () => {
	it('is everything off when nothing was ever saved', () => {
		expect(readNoticePrefs(undefined)).toEqual(DEFAULT_NOTICE_PREFS);
		expect(readNoticePrefs('garbage')).toEqual(DEFAULT_NOTICE_PREFS);
	});

	it('keeps what was saved and fills only what is missing or malformed', () => {
		expect(readNoticePrefs({ evening: true, eveningAt: '22:15', auto: 'yes' })).toEqual({
			...DEFAULT_NOTICE_PREFS,
			evening: true,
			eveningAt: '22:15'
		});
		expect(readNoticePrefs({ eveningAt: '25:00' }).eveningAt).toBe('21:00');
	});

	it('says in one line what is on', () => {
		expect(noticeSummary(DEFAULT_NOTICE_PREFS)).toBe('Vypnuto');
		expect(noticeSummary({ ...DEFAULT_NOTICE_PREFS, evening: true })).toBe('Večer v 21:00');
		expect(noticeSummary({ ...DEFAULT_NOTICE_PREFS, evening: true, eveningAt: '08:30' })).toBe(
			'Večer v 8:30'
		);
		expect(noticeSummary(ALL_ON)).toBe('Večer v 21:00 · platby');
		expect(noticeSummary({ ...DEFAULT_NOTICE_PREFS, awaiting: true })).toBe('Platby');
	});
});

describe('the log', () => {
	it('reads tolerantly', () => {
		expect(readNoticeLog(null)).toEqual(EMPTY_NOTICE_LOG);
		expect(readNoticeLog({ evening: TODAY, payments: ['a:2026-10', 7] })).toEqual({
			evening: TODAY,
			payments: ['a:2026-10']
		});
	});

	it('forgets instances too old to be news again', () => {
		const log = withPaymentsLogged(
			{ evening: null, payments: ['old:2026-06', 'keep:2026-08'] },
			['new:2026-10', 'new:2026-10'],
			TODAY
		);
		expect(log.payments).toEqual(['keep:2026-08', 'new:2026-10']);
	});
});

describe('the evening question', () => {
	it('is not asked before its minute', () => {
		const plan = dueNotices(input({ minute: minutesOf('20:59') }));
		expect(plan.notices).toEqual([]);
		expect(plan.log.evening).toBeNull();
	});

	it('is asked at its minute, once, and remembered', () => {
		const first = dueNotices(input({ minute: minutesOf('21:00') }));
		expect(first.notices.map((n) => n.kind)).toEqual(['evening']);
		expect(first.log.evening).toBe(TODAY);

		const again = dueNotices(input({ log: first.log, minute: minutesOf('23:10') }));
		expect(again.notices).toEqual([]);
	});

	it('is asked again the next day', () => {
		const plan = dueNotices(input({ log: { evening: '2026-10-14', payments: [] } }));
		expect(plan.notices).toHaveLength(1);
	});

	it('is never asked when it is off', () => {
		const plan = dueNotices(input({ prefs: { ...ALL_ON, evening: false } }));
		expect(plan.notices).toEqual([]);
	});

	it('says the day is empty when it is, and opens the keypad', () => {
		const notice = eveningNotice([], [account('kb')], TODAY);
		expect(notice.title).toBe('Máš dnešek zapsaný?');
		expect(notice.body).toBe('Dnešek je zatím prázdný.');
		expect(notice.url).toBe('/zapis');
	});

	it('counts the day’s rows and what they spent, tombstones and other days aside', () => {
		const notice = eveningNotice(
			[
				txn(-249_00),
				txn(-1_000_00),
				txn(45_000_00),
				txn(-99_00, { isDeleted: true }),
				txn(-500_00, { date: '2026-10-14' })
			],
			[account('kb')],
			TODAY
		);
		expect(plain(notice.body)).toBe('Dnes 3 záznamy, utraceno 1 249,00 Kč. Chybí něco?');
	});

	it('never adds koruny to euros', () => {
		const notice = eveningNotice(
			[txn(-249_00), txn(-12_00, { accountId: 'rev' })],
			[account('kb'), account('rev', 'EUR')],
			TODAY
		);
		expect(notice.body).toBe('Dnes 2 záznamy. Chybí něco?');
	});

	it('does not call a move between his own accounts spending', () => {
		const notice = eveningNotice(
			[txn(-2_000_00, { categoryId: null, transferPairId: 'pair' })],
			[account('kb')],
			TODAY
		);
		expect(notice.body).toBe('Dnes 1 záznam. Chybí něco?');
	});
});

describe('the payment notices', () => {
	const mortgage = schedule('Hypotéka', { mode: 'auto', amount: minor(-30_000_00) });
	const netflix = schedule('Netflix');

	it('wait for the payments minute on the due day', () => {
		const plan = dueNotices(
			input({
				prefs: { ...ALL_ON, evening: false },
				minute: minutesOf('08:59'),
				schedules: [mortgage]
			})
		);
		expect(plan.notices).toEqual([]);
	});

	it('say an automatic payment went, and that it records itself', () => {
		const plan = dueNotices(
			input({
				prefs: { ...ALL_ON, evening: false },
				minute: minutesOf('09:00'),
				schedules: [mortgage]
			})
		);
		expect(plan.notices).toHaveLength(1);
		const [notice] = plan.notices;
		expect(notice!.kind).toBe('auto');
		expect(notice!.title).toBe('Proběhla automatická platba');
		expect(plain(notice!.body)).toBe('Hypotéka -30 000,00 Kč · dnes. Do výpisu se zapíše sama.');
		expect(notice!.url).toBe('/vypis');
		expect(plan.log.payments).toEqual([paymentKey('Hypotéka', '2026-10')]);
	});

	it('say a payment waits for its tap, and send it to Domů', () => {
		const plan = dueNotices(
			input({
				prefs: { ...ALL_ON, evening: false },
				minute: minutesOf('09:00'),
				schedules: [netflix]
			})
		);
		const [notice] = plan.notices;
		expect(notice!.kind).toBe('awaiting');
		expect(notice!.title).toBe('Platba čeká na potvrzení');
		expect(plain(notice!.body)).toContain('Netflix -379,00 Kč · dnes.');
		expect(notice!.url).toBe('/');
	});

	it('travel one notice per mode, however many are due', () => {
		const plan = dueNotices(
			input({
				prefs: { ...ALL_ON, evening: false },
				minute: minutesOf('10:00'),
				schedules: [
					netflix,
					schedule('Spotify', { amount: minor(-169_00) }),
					schedule('iCloud', { amount: minor(-25_00) }),
					schedule('Disney', { amount: minor(-199_00) }),
					mortgage
				]
			})
		);
		expect(plan.notices.map((n) => n.kind)).toEqual(['auto', 'awaiting']);
		expect(plan.notices[1]!.title).toBe('Platby čekají na potvrzení');
		expect(plan.notices[1]!.body).toMatch(/ a 1 další\. Potvrdíš je na Domů\.$/);
	});

	it('are said once', () => {
		const first = dueNotices(input({ minute: minutesOf('10:00'), schedules: [netflix] }));
		const again = dueNotices(
			input({ log: first.log, minute: minutesOf('22:00'), schedules: [netflix] })
		);
		expect(again.notices.map((n) => n.kind)).toEqual(['evening']);
	});

	it('respect each switch on its own', () => {
		const autoOnly = dueNotices(
			input({
				prefs: { ...DEFAULT_NOTICE_PREFS, auto: true },
				minute: minutesOf('10:00'),
				schedules: [netflix, mortgage]
			})
		);
		expect(autoOnly.notices.map((n) => n.kind)).toEqual(['auto']);
		// The one not told stays untold, so turning its switch on later still says it.
		expect(autoOnly.log.payments).toEqual([paymentKey('Hypotéka', '2026-10')]);
	});

	it('still come for a day missed this week, at any minute, but not for older ones', () => {
		const lastWeek = schedule('Nájem', { dayOfMonth: 9 });
		const tooOld = schedule('Pojistka', { dayOfMonth: 2 });
		const plan = dueNotices(
			input({
				prefs: { ...ALL_ON, evening: false },
				minute: minutesOf('07:00'),
				schedules: [lastWeek, tooOld]
			})
		);
		expect(plan.notices).toHaveLength(1);
		expect(plan.notices[0]!.body).toContain('Nájem');
		expect(plain(plan.notices[0]!.body)).toContain('9. října');
		expect(plan.notices[0]!.body).not.toContain('Pojistka');
	});

	it('say nothing about a month already settled', () => {
		const plan = dueNotices(
			input({ schedules: [schedule('Netflix', { lastPostedMonth: '2026-10' })] })
		);
		expect(plan.notices.map((n) => n.kind)).toEqual(['evening']);
	});

	it('speak an account’s own currency', () => {
		const plan = dueNotices(
			input({
				prefs: { ...ALL_ON, evening: false },
				accounts: [account('kb'), account('rev', 'EUR')],
				schedules: [schedule('Spotify', { accountId: 'rev', amount: minor(-10_99) })]
			})
		);
		expect(plain(plan.notices[0]!.body)).toContain('Spotify -10,99 €');
	});
});

describe('the wake times', () => {
	it('are none when everything is off', () => {
		expect(wakeTimes(DEFAULT_NOTICE_PREFS, [schedule('Netflix')], TODAY)).toEqual([]);
	});

	it('wake every evening at the chosen minute, from today, for the horizon', () => {
		const wakes = wakeTimes(
			{ ...DEFAULT_NOTICE_PREFS, evening: true, eveningAt: '21:45' },
			[],
			TODAY
		);
		expect(wakes).toHaveLength(WAKE_HORIZON_DAYS);
		expect(wakes[0]).toBe('2026-10-15T21:45');
		expect(wakes[1]).toBe('2026-10-16T21:45');
		expect(wakes.at(-1)).toBe('2026-12-13T21:45');
	});

	it('wake on the morning of each coming due day, not on one already settled', () => {
		const wakes = wakeTimes(
			{ ...DEFAULT_NOTICE_PREFS, awaiting: true, paymentsAt: '08:30' },
			[
				schedule('Netflix', { dayOfMonth: 15 }),
				schedule('Nájem', { dayOfMonth: 20 }),
				schedule('Spotify', { dayOfMonth: 1, lastPostedMonth: '2026-11' }),
				schedule('Archiv', { dayOfMonth: 25, isArchived: true })
			],
			TODAY
		);
		expect(wakes).toEqual([
			'2026-10-15T08:30',
			'2026-10-20T08:30',
			'2026-11-15T08:30',
			'2026-11-20T08:30',
			'2026-12-01T08:30'
		]);
	});

	it('wake only for the modes switched on', () => {
		const wakes = wakeTimes(
			{ ...DEFAULT_NOTICE_PREFS, auto: true },
			[
				schedule('Netflix', { dayOfMonth: 16 }),
				schedule('Hypotéka', { mode: 'auto', dayOfMonth: 17 })
			],
			TODAY
		);
		expect(wakes).toEqual(['2026-10-17T09:00', '2026-11-17T09:00']);
	});

	it('respect a schedule’s first and last month', () => {
		const wakes = wakeTimes(
			{ ...DEFAULT_NOTICE_PREFS, awaiting: true },
			[
				schedule('Later', { dayOfMonth: 16, startMonth: '2026-11', lastPostedMonth: null }),
				schedule('Ending', { dayOfMonth: 16, endMonth: '2026-10' })
			],
			TODAY
		);
		expect(wakes).toEqual(['2026-10-16T09:00', '2026-11-16T09:00']);
	});

	it('share one wake when the evening and a payment fall on the same minute', () => {
		const wakes = wakeTimes(
			{ ...ALL_ON, eveningAt: '09:00' },
			[schedule('Netflix', { dayOfMonth: 16 })],
			TODAY
		);
		expect(wakes.filter((w) => w === '2026-10-16T09:00')).toHaveLength(1);
	});

	it('are bounded', () => {
		const many = Array.from({ length: 31 }, (_, day) =>
			schedule(`s${day}`, { dayOfMonth: day + 1, lastPostedMonth: null })
		);
		const wakes = wakeTimes({ ...ALL_ON, paymentsAt: '08:00' }, many, TODAY);
		expect(wakes.length).toBeLessThanOrEqual(MAX_WAKES);
		expect(wakes[0]).toBe('2026-10-15T08:00');
	});
});

describe('the launch’s own rows', () => {
	it('are said as written, not as coming', () => {
		const notice = postedNotice(
			[
				{
					schedule: schedule('Hypotéka', { mode: 'auto', amount: minor(-30_000_00) }),
					month: '2026-10',
					date: TODAY
				}
			],
			[account('kb')]
		);
		expect(notice!.title).toBe('Zapsáno automaticky');
		expect(plain(notice!.body)).toBe('Hypotéka -30 000,00 Kč');
		expect(notice!.url).toBe('/vypis');
	});

	it('are nothing when nothing was written', () => {
		expect(postedNotice([], [account('kb')])).toBeNull();
	});
});

describe('the open tab’s timer', () => {
	const at = (clock: string) =>
		new Date(2026, 9, 15, ...(clock.split(':').map(Number) as [number, number]));

	it('sleeps when nothing is on', () => {
		expect(msUntilNextCheck(DEFAULT_NOTICE_PREFS, at('12:00'))).toBeNull();
	});

	it('wakes at the next minute that matters, a second inside it', () => {
		expect(msUntilNextCheck(ALL_ON, at('12:00'))).toBe(9 * 60 * 60_000 + 1000);
		expect(msUntilNextCheck(ALL_ON, at('08:00'))).toBe(60 * 60_000 + 1000);
	});

	it('rolls over to tomorrow once today’s minutes have passed', () => {
		const evening = { ...DEFAULT_NOTICE_PREFS, evening: true };
		expect(msUntilNextCheck(evening, at('21:00'))).toBe(24 * 60 * 60_000 + 1000);
		expect(msUntilNextCheck(evening, at('22:00'))).toBe(23 * 60 * 60_000 + 1000);
	});
});
