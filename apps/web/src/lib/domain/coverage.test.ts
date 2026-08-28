import { describe, expect, it } from 'vitest';
import { daysSinceLastEntry, monthCoverage, quietStreak } from './coverage';
import { minor } from './money';
import type { Txn } from './types';

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

let seq = 0;
function txn(date: string, patch: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `t${seq}`,
		accountId: 'acc',
		date,
		amount: minor(-24900),
		categoryId: 'cat',
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		createdAt: `${date}T10:00:00.000Z`,
		isOneOff: false,
		owedAmount: null,
		owedBy: null,
		settledByTxnId: null,
		scheduleId: null,
		...SYNCED,
		...patch
	};
}

describe('monthCoverage', () => {
	it('measures against days elapsed, not days in the month', () => {
		// The 3rd, with one day spent on. Against 31 the quiet share would read
		// as 97 % on a month that has barely started.
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01'), txn('2026-08-02')],
			today: '2026-08-03'
		});

		expect(result.elapsed).toBe(3);
		expect(result.spending).toBe(2);
		expect(result.quiet).toBe(1);
		expect(result.percent).toBe(33);
	});

	it('counts a day nobody recorded as a day without an expense', () => {
		// The whole reversal: no mark, no tap, no hole. Nothing was spent.
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01')],
			today: '2026-08-03'
		});

		expect(result.quiet).toBe(2);
		expect(result.quietDays).toEqual(['2026-08-02', '2026-08-03']);
	});

	it('lists the quiet days, oldest first', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01'), txn('2026-08-04')],
			today: '2026-08-05'
		});

		expect(result.quietDays).toEqual(['2026-08-02', '2026-08-03', '2026-08-05']);
	});

	it('leaves a day that only saw money arrive quiet', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-02', { amount: minor(4500000) })],
			today: '2026-08-02'
		});

		expect(result.spending).toBe(0);
		expect(result.quiet).toBe(2);
	});

	it('treats several rows on one day as one spending day', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01'), txn('2026-08-01'), txn('2026-08-01')],
			today: '2026-08-02'
		});

		expect(result.spending).toBe(1);
		expect(result.elapsed).toBe(2);
	});

	it('ignores a deleted row', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01', { isDeleted: true })],
			today: '2026-08-01'
		});

		expect(result.spending).toBe(0);
		expect(result.quiet).toBe(1);
	});

	it('runs a past month to its own end, not to today', () => {
		const result = monthCoverage({
			month: '2026-07',
			txns: [txn('2026-07-01')],
			today: '2026-08-15'
		});

		expect(result.elapsed).toBe(31);
		expect(result.spending).toBe(1);
		expect(result.quiet).toBe(30);
	});

	it('reads a future month as nothing yet rather than as a perfect one', () => {
		const result = monthCoverage({
			month: '2026-12',
			txns: [],
			today: '2026-08-15'
		});

		expect(result.elapsed).toBe(0);
		expect(result.percent).toBe(0);
		expect(result.quietDays).toEqual([]);
	});

	it('ignores rows from a different month', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-07-31'), txn('2026-09-01')],
			today: '2026-08-02'
		});

		expect(result.spending).toBe(0);
		expect(result.quiet).toBe(2);
	});
});

describe('quietStreak', () => {
	it('counts consecutive days without an expense, ending yesterday', () => {
		const streak = quietStreak({
			txns: [txn('2026-08-23')],
			today: '2026-08-27'
		});

		// 24th, 25th, 26th. Today is still open and is not claimed.
		expect(streak.days).toBe(3);
	});

	it('is zero the moment something is spent today', () => {
		const streak = quietStreak({
			txns: [txn('2026-08-20'), txn('2026-08-27')],
			today: '2026-08-27'
		});

		expect(streak.days).toBe(0);
	});

	it('is zero when yesterday cost money, however quiet today is', () => {
		const streak = quietStreak({
			txns: [txn('2026-08-26')],
			today: '2026-08-27'
		});

		expect(streak.days).toBe(0);
	});

	it('never reaches back past the first row in the ledger', () => {
		// Two days of history, both quiet — not four hundred.
		const streak = quietStreak({
			txns: [txn('2026-08-25', { amount: minor(1000) })],
			today: '2026-08-27'
		});

		expect(streak.days).toBe(2);
	});

	it('is zero on an empty ledger', () => {
		expect(quietStreak({ txns: [], today: '2026-08-27' }).days).toBe(0);
	});

	it('walks across a month boundary', () => {
		const streak = quietStreak({
			txns: [txn('2026-07-28')],
			today: '2026-08-02'
		});

		expect(streak.days).toBe(4);
	});

	it('stops walking rather than running forever', () => {
		const streak = quietStreak({
			txns: [txn('2020-01-01')],
			today: '2026-08-27',
			maxDays: 5
		});

		expect(streak.days).toBe(5);
	});
});

describe('daysSinceLastEntry', () => {
	it('is null when nothing was ever recorded', () => {
		expect(daysSinceLastEntry([], '2026-08-27')).toBeNull();
	});

	it('counts from the newest row', () => {
		expect(daysSinceLastEntry([txn('2026-08-20'), txn('2026-08-24')], '2026-08-27')).toBe(3);
	});

	it('ignores a row dated in the future', () => {
		expect(daysSinceLastEntry([txn('2026-08-24'), txn('2026-09-30')], '2026-08-27')).toBe(3);
	});
});
