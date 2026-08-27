import { describe, expect, it } from 'vitest';
import { currentStreak, daysSinceLastEntry, monthCoverage } from './coverage';
import { minor } from './money';
import type { DayMark, Txn } from './types';

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

const mark = (date: string): DayMark => ({
	date,
	deviceId: 'dev',
	updatedAt: `${date}T23:00:00.000Z`
});

describe('monthCoverage', () => {
	it('measures against days elapsed, not days in the month', () => {
		// The 3rd, with two days recorded. Against 31 this would read as 6 %.
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01'), txn('2026-08-02')],
			marks: [],
			today: '2026-08-03'
		});

		expect(result.elapsed).toBe(3);
		expect(result.covered).toBe(2);
		expect(result.percent).toBe(67);
	});

	it('counts an explicit mark as a recorded day — the reason DayMark exists', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01')],
			marks: [mark('2026-08-02'), mark('2026-08-03')],
			today: '2026-08-03'
		});

		expect(result.covered).toBe(3);
		expect(result.percent).toBe(100);
		expect(result.gaps).toEqual([]);
	});

	it('lists the holes, oldest first', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01'), txn('2026-08-04')],
			marks: [],
			today: '2026-08-05'
		});

		expect(result.gaps).toEqual(['2026-08-02', '2026-08-03', '2026-08-05']);
	});

	it('treats several rows on one day as one covered day', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01'), txn('2026-08-01'), txn('2026-08-01')],
			marks: [],
			today: '2026-08-02'
		});

		expect(result.covered).toBe(1);
		expect(result.elapsed).toBe(2);
	});

	it('ignores a deleted row', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-08-01', { isDeleted: true })],
			marks: [],
			today: '2026-08-01'
		});

		expect(result.covered).toBe(0);
	});

	it('runs a past month to its own end, not to today', () => {
		const result = monthCoverage({
			month: '2026-07',
			txns: [txn('2026-07-01')],
			marks: [],
			today: '2026-08-15'
		});

		expect(result.elapsed).toBe(31);
		expect(result.covered).toBe(1);
	});

	it('reads a future month as nothing missed yet rather than as total failure', () => {
		const result = monthCoverage({
			month: '2026-12',
			txns: [],
			marks: [],
			today: '2026-08-15'
		});

		expect(result.elapsed).toBe(0);
		expect(result.percent).toBe(100);
		expect(result.gaps).toEqual([]);
	});

	it('ignores rows from a different month', () => {
		const result = monthCoverage({
			month: '2026-08',
			txns: [txn('2026-07-31'), txn('2026-09-01')],
			marks: [mark('2026-07-15')],
			today: '2026-08-02'
		});

		expect(result.covered).toBe(0);
	});
});

describe('currentStreak', () => {
	it('counts consecutive days ending today', () => {
		const days = ['2026-08-25', '2026-08-26', '2026-08-27'];

		const streak = currentStreak({
			txns: days.map((d) => txn(d)),
			marks: [],
			today: '2026-08-27'
		});

		expect(streak).toEqual({ days: 3, includesToday: true });
	});

	it('survives a today that has nothing in it yet', () => {
		// A streak that dies at midnight punishes the person who records at
		// breakfast, so yesterday still counts — flagged as at risk, not broken.
		const streak = currentStreak({
			txns: [txn('2026-08-25'), txn('2026-08-26')],
			marks: [],
			today: '2026-08-27'
		});

		expect(streak).toEqual({ days: 2, includesToday: false });
	});

	it('is broken once yesterday is empty too', () => {
		const streak = currentStreak({
			txns: [txn('2026-08-24'), txn('2026-08-25')],
			marks: [],
			today: '2026-08-27'
		});

		expect(streak.days).toBe(0);
	});

	it('counts a marked day as covered', () => {
		const streak = currentStreak({
			txns: [txn('2026-08-27')],
			marks: [mark('2026-08-26'), mark('2026-08-25')],
			today: '2026-08-27'
		});

		expect(streak.days).toBe(3);
	});

	it('walks across a month boundary', () => {
		const streak = currentStreak({
			txns: [txn('2026-07-30'), txn('2026-07-31'), txn('2026-08-01')],
			marks: [],
			today: '2026-08-01'
		});

		expect(streak.days).toBe(3);
	});

	it('is zero on an empty ledger', () => {
		expect(currentStreak({ txns: [], marks: [], today: '2026-08-27' }).days).toBe(0);
	});

	it('stops walking rather than running forever', () => {
		const days = Array.from({ length: 40 }, (_, i) =>
			txn(`2026-08-${String(27 - (i % 27)).padStart(2, '0')}`)
		);

		const streak = currentStreak({ txns: days, marks: [], today: '2026-08-27', maxDays: 5 });

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
