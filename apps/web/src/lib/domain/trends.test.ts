import { describe, expect, it } from 'vitest';
import { categoryTrends, monthlyRows, monthsCovered } from './trends';
import { minor } from './money';
import type { Category, Txn } from './types';

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

function category(id: string, name: string, patch: Partial<Category> = {}): Category {
	return {
		id,
		parentId: null,
		name,
		spendType: 'want',
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		...SYNCED,
		...patch
	};
}

let seq = 0;
function txn(date: string, amount: number, categoryId: string, patch: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `t${seq}`,
		accountId: 'acc',
		date,
		amount: minor(amount),
		categoryId,
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		createdAt: `${date}T10:00:00.000Z`,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		...SYNCED,
		...patch
	};
}

const categories = [
	category('food', 'JÍDLO'),
	category('rent', 'BYDLENÍ', { spendType: 'need' }),
	category('pay', 'PŘÍJEM', { isIncome: true, spendType: 'save' })
];

const TODAY = '2026-08-27';

describe('categoryTrends', () => {
	it('lines a bucket up across the window, oldest first', () => {
		const txns = [
			txn('2026-06-04', -1_000_00, 'food'),
			txn('2026-07-04', -1_000_00, 'food'),
			txn('2026-08-04', -3_000_00, 'food')
		];

		const [food] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 3 });

		expect(food?.points.map((p) => p.month)).toEqual(['2026-06', '2026-07', '2026-08']);
		expect(food?.points.map((p) => p.amount)).toEqual([1_000_00, 1_000_00, 3_000_00]);
	});

	it('compares this month against the average of the earlier ones', () => {
		const txns = [
			txn('2026-06-04', -1_000_00, 'food'),
			txn('2026-07-04', -2_000_00, 'food'),
			txn('2026-08-04', -3_000_00, 'food')
		];

		const [food] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 3 });

		expect(food?.typical).toBe(1_500_00);
		expect(food?.change).toBe(1_500_00);
		expect(food?.changePercent).toBe(100);
		expect(food?.direction).toBe('up');
	});

	it('refuses a verdict when there is nothing to compare to', () => {
		const txns = [txn('2026-08-04', -3_000_00, 'food')];

		const [food] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 1 });

		expect(food?.typical).toBeNull();
		expect(food?.change).toBeNull();
		expect(food?.direction).toBe('flat');
	});

	it('calls a small move flat rather than news', () => {
		// 20 Kč on a 1 000 Kč bucket: 2 %, and under the 50 Kč floor.
		const txns = [txn('2026-07-04', -1_000_00, 'food'), txn('2026-08-04', -1_020_00, 'food')];

		const [food] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 2 });

		expect(food?.direction).toBe('flat');
	});

	it('calls a big percentage on a tiny bucket flat too', () => {
		// Doubled, and still only 30 Kč — under the absolute floor.
		const txns = [txn('2026-07-04', -30_00, 'food'), txn('2026-08-04', -60_00, 'food')];

		const [food] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 2 });

		expect(food?.changePercent).toBe(100);
		expect(food?.direction).toBe('flat');
	});

	it('keeps a one-off out of what the month costs', () => {
		const txns = [
			txn('2026-07-04', -1_000_00, 'rent'),
			txn('2026-08-04', -1_000_00, 'rent'),
			txn('2026-08-19', -41_890_00, 'rent', { isOneOff: true })
		];

		const [rent] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 2 });

		expect(rent?.latest).toBe(1_000_00);
		expect(rent?.direction).toBe('flat');
	});

	it('nets a refund against its bucket instead of counting it as income', () => {
		const txns = [
			txn('2026-07-04', -2_000_00, 'rent'),
			txn('2026-08-04', -2_000_00, 'rent'),
			txn('2026-08-20', 1_250_00, 'rent')
		];

		const [rent] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 2 });

		expect(rent?.latest).toBe(750_00);
	});

	it('never reports an income bucket as a spending trend', () => {
		const txns = [txn('2026-08-01', 59_400_00, 'pay'), txn('2026-08-04', -1_000_00, 'food')];

		const trends = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 2 });

		expect(trends.map((t) => t.categoryId)).toEqual(['food']);
	});

	it('leaves out a bucket that was dormant all window', () => {
		const txns = [txn('2026-08-04', -1_000_00, 'food')];

		const trends = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 3 });

		expect(trends.map((t) => t.name)).toEqual(['JÍDLO']);
	});

	it('ranks by distance from normal, not by size', () => {
		const txns = [
			// Rent is the biggest bucket and it never moves — knowing that is worth
			// nothing, so it must not lead.
			txn('2026-07-01', -14_200_00, 'rent'),
			txn('2026-08-01', -14_200_00, 'rent'),
			txn('2026-07-04', -1_000_00, 'food'),
			txn('2026-08-04', -4_000_00, 'food')
		];

		const trends = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 2 });

		expect(trends[0]?.name).toBe('JÍDLO');
	});

	it('does not average in months from before the ledger existed', () => {
		// Two real months, asked for a six-month window. The four months that
		// predate the first transaction are not months anybody spent nothing in —
		// they are months that do not exist, and counting them as zeroes made
		// every bucket in month two read as a catastrophe.
		const txns = [txn('2026-07-04', -2_000_00, 'food'), txn('2026-08-04', -3_000_00, 'food')];

		const [food] = categoryTrends({ month: '2026-08', txns, categories, today: TODAY, window: 6 });

		expect(food?.points.map((p) => p.month)).toEqual(['2026-07', '2026-08']);
		expect(food?.typical).toBe(2_000_00);
		expect(food?.changePercent).toBe(50);
	});

	it('still counts a genuine zero month inside the ledger', () => {
		// Nothing on food in July, but the ledger was open — rent proves it. That
		// zero is a fact and belongs in the average.
		const txns = [
			txn('2026-06-04', -2_000_00, 'food'),
			txn('2026-07-01', -14_200_00, 'rent'),
			txn('2026-08-04', -3_000_00, 'food')
		];

		const [, food] = categoryTrends({
			month: '2026-08',
			txns,
			categories,
			today: TODAY,
			window: 6
		}).sort((a, b) => a.name.localeCompare(b.name));

		expect(food?.points.map((p) => p.amount)).toEqual([2_000_00, 0, 3_000_00]);
		expect(food?.typical).toBe(1_000_00);
	});
});

describe('monthlyRows', () => {
	it('reports each month separately, one-offs split out', () => {
		const txns = [
			txn('2026-08-01', 59_400_00, 'pay'),
			txn('2026-08-04', -1_000_00, 'food'),
			txn('2026-08-19', -41_890_00, 'rent', { isOneOff: true })
		];

		const [august] = monthlyRows({ months: ['2026-08'], txns, categories, today: TODAY });

		expect(august).toMatchObject({
			month: '2026-08',
			income: 59_400_00,
			net: 59_400_00 - 42_890_00,
			recurringOutflow: -1_000_00,
			oneOffOutflow: -41_890_00
		});
	});
});

describe('monthsCovered', () => {
	it('lists every month the ledger touches, oldest first', () => {
		const txns = [
			txn('2026-08-04', -1_000_00, 'food'),
			txn('2026-06-04', -1_000_00, 'food'),
			txn('2026-08-20', -1_000_00, 'food')
		];

		expect(monthsCovered(txns)).toEqual(['2026-06', '2026-08']);
	});

	it('ignores a deleted row', () => {
		const txns = [txn('2026-06-04', -1_000_00, 'food', { isDeleted: true })];

		expect(monthsCovered(txns)).toEqual([]);
	});
});
