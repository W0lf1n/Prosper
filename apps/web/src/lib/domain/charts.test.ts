import { describe, expect, it } from 'vitest';
import { balanceScopes, balanceSeries, spendCalendar, spendPace } from './charts';
import { minor } from './money';
import { prosperitySplit, splitBars } from './prosperity';
import type { Account, Category, SpendType, Txn } from './types';

const SYNCED = { updatedAt: '2026-10-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };
const TODAY = '2026-10-18';

function category(id: string, patch: Partial<Category> = {}): Category {
	return {
		id,
		name: id.toUpperCase(),
		parentId: null,
		spendType: 'need',
		isIncome: false,
		isArchived: false,
		monthlyCap: null,
		sortOrder: 0,
		icon: null,
		color: null,
		...SYNCED,
		...patch
	} as Category;
}

const FOOD = category('food');
const SALARY = category('salary', { isIncome: true });
const CATEGORIES = [FOOD, SALARY];

let seq = 0;
function txn(date: string, amount: number, extra: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `txn-${seq}`,
		accountId: 'kb',
		date,
		amount: minor(amount),
		categoryId: amount < 0 ? 'food' : 'salary',
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		isProvisional: false,
		shares: [],
		scheduleId: null,
		createdAt: `${date}T${String(10 + (seq % 10)).padStart(2, '0')}:00:00.000Z`,
		...SYNCED,
		...extra
	};
}

function account(id: string, patch: Partial<Account> = {}): Account {
	return {
		id,
		name: id,
		kind: 'checking',
		openingBalance: minor(10_000_00),
		openingDate: '2026-01-01',
		pockets: [],
		currency: 'CZK',
		isArchived: false,
		sortOrder: 0,
		...SYNCED,
		...patch
	};
}

describe('Kalendář útraty', () => {
	it('lays the month out Monday first, padded to whole weeks', () => {
		// 1 October 2026 is a Thursday.
		const calendar = spendCalendar({
			txns: [],
			categories: CATEGORIES,
			month: '2026-10',
			today: TODAY
		});
		expect(calendar.weeks[0]!.slice(0, 3)).toEqual([null, null, null]);
		expect(calendar.weeks[0]![3]!.date).toBe('2026-10-01');
		expect(calendar.weeks.every((w) => w.length === 7)).toBe(true);
		expect(calendar.weeks.flat().filter(Boolean)).toHaveLength(31);
	});

	it('shades each day by its quartile among the month’s spending days', () => {
		const calendar = spendCalendar({
			txns: [
				txn('2026-10-01', -100_00),
				txn('2026-10-02', -200_00),
				txn('2026-10-03', -300_00),
				txn('2026-10-04', -15_000_00),
				txn('2026-10-05', 45_000_00)
			],
			categories: CATEGORIES,
			month: '2026-10',
			today: TODAY
		});
		const level = (date: string) => calendar.weeks.flat().find((d) => d?.date === date)!.level;
		expect(level('2026-10-01')).toBe(1);
		expect(level('2026-10-02')).toBe(2);
		expect(level('2026-10-03')).toBe(3);
		expect(level('2026-10-04')).toBe(4);
		// Income is not spending, so the 5th cost nothing.
		expect(level('2026-10-05')).toBe(0);
		expect(calendar.peak!.date).toBe('2026-10-04');
		expect(calendar.total).toBe(15_600_00);
		expect(calendar.quiet).toBe(18 - 4);
		expect(calendar.elapsed).toBe(18);
	});

	it('nets a refund against the day and never counts a move', () => {
		const calendar = spendCalendar({
			txns: [
				txn('2026-10-06', -500_00),
				txn('2026-10-06', 200_00, { categoryId: 'food' }),
				txn('2026-10-07', -2_000_00, { categoryId: null, transferPairId: 'pair' }),
				txn('2026-10-08', -99_00, { isDeleted: true })
			],
			categories: CATEGORIES,
			month: '2026-10',
			today: TODAY
		});
		const day = (date: string) => calendar.weeks.flat().find((d) => d?.date === date)!;
		expect(day('2026-10-06').spent).toBe(300_00);
		expect(day('2026-10-06').count).toBe(1);
		expect(day('2026-10-07').spent).toBe(0);
		expect(day('2026-10-08').spent).toBe(0);
	});

	it('leaves the days to come unshaded and unjudged', () => {
		const calendar = spendCalendar({
			txns: [txn('2026-10-25', -100_00)],
			categories: CATEGORIES,
			month: '2026-10',
			today: TODAY
		});
		const day = calendar.weeks.flat().find((d) => d?.date === '2026-10-25')!;
		expect(day.isFuture).toBe(true);
		expect(day.level).toBe(0);
		expect(calendar.total).toBe(0);
		expect(calendar.weeks.flat().find((d) => d?.date === TODAY)!.isToday).toBe(true);
	});
});

describe('Tempo útraty', () => {
	const rows = [
		txn('2026-09-02', -1_000_00),
		txn('2026-09-15', -2_000_00),
		txn('2026-09-30', -500_00),
		txn('2026-10-01', -400_00),
		txn('2026-10-10', -100_00),
		txn('2026-10-20', -9_000_00)
	];

	it('runs this month to today and last month to its end', () => {
		const pace = spendPace({ txns: rows, categories: CATEGORIES, month: '2026-10', today: TODAY });
		expect(pace.current).toHaveLength(18);
		expect(pace.current.at(-1)!.total).toBe(500_00);
		expect(pace.previous).toHaveLength(30);
		expect(pace.previous.at(-1)!.total).toBe(3_500_00);
		expect(pace.days).toBe(31);
		expect(pace.today).toBe(18);
	});

	it('compares the same day of both months', () => {
		const pace = spendPace({ txns: rows, categories: CATEGORIES, month: '2026-10', today: TODAY });
		// 500 so far against 3 000 by the 18th of September.
		expect(pace.delta).toBe(500_00 - 3_000_00);
	});

	it('has nothing to compare with when last month is empty', () => {
		const pace = spendPace({
			txns: [txn('2026-10-01', -400_00)],
			categories: CATEGORIES,
			month: '2026-10',
			today: TODAY
		});
		expect(pace.previous).toEqual([]);
		expect(pace.delta).toBeNull();
	});

	it('compares against the last day of a shorter month', () => {
		const pace = spendPace({
			txns: [txn('2026-02-28', -100_00), txn('2026-03-31', -50_00)],
			categories: CATEGORIES,
			month: '2026-03',
			today: '2026-03-31'
		});
		expect(pace.delta).toBe(50_00 - 100_00);
	});
});

describe('Vývoj zůstatku', () => {
	const accounts = [
		account('kb'),
		account('eur', { currency: 'EUR', openingBalance: minor(500_00) })
	];
	const rows = [
		txn('2026-10-11', -1_000_00),
		txn('2026-10-17', 3_000_00),
		txn('2026-10-18', -200_00, { createdAt: '2026-10-18T08:00:00.000Z' }),
		txn('2026-10-18', -300_00, { createdAt: '2026-10-18T12:00:00.000Z' }),
		txn('2026-10-12', -40_00, { accountId: 'eur' })
	];

	it('ends at the balance and says what the week did to it', () => {
		const series = balanceSeries({
			accounts,
			txns: rows,
			currency: 'CZK',
			range: 'week',
			today: TODAY
		});
		expect(series.points).toHaveLength(8);
		expect(series.points[0]!.at).toBe('2026-10-11');
		expect(series.first).toBe(9_000_00);
		expect(series.last).toBe(11_500_00);
		expect(series.change).toBe(2_500_00);
		expect(series.low).toBe(9_000_00);
		expect(series.high).toBe(12_000_00);
	});

	it('draws one account alone when asked', () => {
		const two = [account('kb'), account('cash', { openingBalance: minor(1_000_00) })];
		const series = balanceSeries({
			accounts: two,
			txns: rows,
			currency: 'CZK',
			accountId: 'cash',
			range: 'week',
			today: TODAY
		});
		expect(series.last).toBe(1_000_00);
	});

	it('steps through the active currency first, as a whole and account by account', () => {
		const scopes = balanceScopes(
			[
				account('eur', { currency: 'EUR', name: 'Revolut' }),
				account('kb', { name: 'Běžný' }),
				account('cash', { name: 'Hotovost', sortOrder: 1 }),
				account('old', { isArchived: true })
			],
			'CZK'
		);
		expect(scopes.map((s) => s.label)).toEqual(['Vše · CZK', 'Běžný', 'Hotovost', 'Revolut']);
		expect(scopes[3]).toMatchObject({ currency: 'EUR', accountId: 'eur' });
	});

	it('never adds the euro account to the koruna line', () => {
		const series = balanceSeries({
			accounts,
			txns: rows,
			currency: 'EUR',
			range: 'week',
			today: TODAY
		});
		expect(series.last).toBe(460_00);
	});

	it('steps through today row by row on the day range', () => {
		const series = balanceSeries({
			accounts,
			txns: rows,
			currency: 'CZK',
			range: 'day',
			today: TODAY
		});
		expect(series.points.map((p) => p.value)).toEqual([12_000_00, 11_800_00, 11_500_00]);
		expect(series.change).toBe(-500_00);
	});

	it('draws a flat day when nothing happened today', () => {
		const series = balanceSeries({
			accounts,
			txns: rows,
			currency: 'CZK',
			range: 'day',
			today: '2026-10-19'
		});
		expect(series.points).toHaveLength(2);
		expect(series.change).toBe(0);
	});

	it('counts an account from its opening day only', () => {
		const late = [
			account('kb'),
			account('cash', { openingDate: '2026-10-15', openingBalance: minor(2_000_00) })
		];
		const series = balanceSeries({
			accounts: late,
			txns: [],
			currency: 'CZK',
			range: 'week',
			today: TODAY
		});
		expect(series.first).toBe(10_000_00);
		expect(series.last).toBe(12_000_00);
	});

	it('starts a range longer than the ledger at the ledger’s first day, and says so', () => {
		const young = [account('kb', { openingDate: '2026-08-03' })];
		const series = balanceSeries({
			accounts: young,
			txns: rows,
			currency: 'CZK',
			range: 'year',
			today: TODAY
		});
		expect(series.clamped).toBe(true);
		expect(series.points[0]!.at).toBe('2026-08-03');
		expect(series.first).toBe(10_000_00);

		const week = balanceSeries({
			accounts: young,
			txns: rows,
			currency: 'CZK',
			range: 'week',
			today: TODAY
		});
		expect(week.clamped).toBe(false);
	});

	it('reaches back to the first entry on the whole range, a week at a time when it is long', () => {
		const series = balanceSeries({
			accounts,
			txns: rows,
			currency: 'CZK',
			range: 'max',
			today: TODAY
		});
		expect(series.points[0]!.at).toBe('2026-01-01');
		expect(series.points.at(-1)!.at).toBe(TODAY);
		expect(series.last).toBe(11_500_00);

		const long = balanceSeries({
			accounts: [account('kb', { openingDate: '2024-01-01' })],
			txns: [],
			currency: 'CZK',
			range: 'max',
			today: TODAY
		});
		expect(long.points.length).toBeLessThan(200);
		expect(long.points.at(-1)!.at).toBe(TODAY);
	});
});

describe('the split as four meters', () => {
	function bucket(spendType: SpendType, total: number) {
		const c = category(spendType, { spendType });
		return {
			category: c,
			total: minor(total),
			oneOffTotal: minor(0),
			count: 1,
			rows: [],
			share: 0,
			recurringShare: 0
		};
	}

	it('says each class in money against its own mark', () => {
		const split = prosperitySplit({
			income: minor(50_000_00),
			buckets: [
				bucket('give', -5_000_00),
				bucket('save', -2_000_00),
				bucket('need', -30_000_00),
				bucket('want', -8_000_00)
			]
		});
		const bars = splitBars(split);
		const by = (cls: string) => bars.find((b) => b.cls === cls)!;

		expect(by('give')).toMatchObject({ state: 'met', mark: 5_000_00, gap: 0, fill: 100 });
		expect(by('save')).toMatchObject({ state: 'short', mark: 5_000_00, gap: 3_000_00, fill: 40 });
		expect(by('debt')).toMatchObject({ state: 'short', gap: 5_000_00, fill: 0 });
		expect(by('live')).toMatchObject({ state: 'over', mark: 35_000_00, gap: 3_000_00, fill: 100 });
	});

	it('calls living under its share room left, not a shortfall', () => {
		const split = prosperitySplit({
			income: minor(50_000_00),
			buckets: [bucket('need', -20_000_00)]
		});
		const live = splitBars(split).find((b) => b.cls === 'live')!;
		expect(live).toMatchObject({ state: 'within', gap: 15_000_00, fill: 57 });
	});
});
