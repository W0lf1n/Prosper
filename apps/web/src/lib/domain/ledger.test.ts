import { describe, expect, it } from 'vitest';
import { balanceOf, buildTape, categoryOrder, categoryRanking, recentPayees } from './ledger';
import { minor, type Minor } from './money';
import type { Txn } from './types';

let counter = 0;

function txn(date: string, amount: number, extra: Partial<Txn> = {}): Txn {
	counter += 1;
	const seq = String(counter).padStart(4, '0');
	return {
		id: `txn-${seq}`,
		accountId: 'acc-1',
		date,
		amount: minor(amount),
		categoryId: null,
		payee: '',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		createdAt: `2026-08-01T10:00:${seq.slice(-2)}.000Z`,
		updatedAt: '2026-08-01T10:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

const OPENING = minor(100000) as Minor; // 1 000,00 Kč

describe('buildTape()', () => {
	it('groups by month, newest day first', () => {
		const tape = buildTape([txn('2026-08-20', -5000), txn('2026-07-30', -2500)], {
			openingBalance: OPENING,
			today: '2026-08-20'
		});

		expect(tape.map((m) => m.key)).toEqual(['2026-08', '2026-07']);
		expect(tape[0]!.days[0]!.date).toBe('2026-08-20');
	});

	it('carries a running balance forward from the opening balance', () => {
		const tape = buildTape([txn('2026-08-19', -25000), txn('2026-08-20', -5000)], {
			openingBalance: OPENING,
			today: '2026-08-20'
		});

		const days = tape[0]!.days;
		expect(days[0]!.date).toBe('2026-08-20');
		expect(days[0]!.balance).toBe(70000); // 1000 - 250 - 50
		expect(days[1]!.balance).toBe(75000); // 1000 - 250
	});

	it('materialises the days nothing happened on, rather than skipping them', () => {
		const tape = buildTape([txn('2026-08-18', -5000)], {
			openingBalance: OPENING,
			today: '2026-08-20'
		});

		const days = tape[0]!.days;
		expect(days.map((d) => d.date)).toEqual(['2026-08-20', '2026-08-19', '2026-08-18']);
		// An empty day carries no flag of its own: no rows is the whole story.
		expect(days.map((d) => d.rows.length)).toEqual([0, 0, 1]);
	});

	it('totals inflow and outflow per month', () => {
		const tape = buildTape(
			[txn('2026-08-01', 3500000), txn('2026-08-02', -120000), txn('2026-08-03', -45050)],
			{ openingBalance: OPENING, today: '2026-08-03' }
		);

		const month = tape[0]!;
		expect(month.inflow).toBe(3500000);
		expect(month.outflow).toBe(-165050);
		expect(month.net).toBe(3334950);
	});

	it('orders same-day transactions newest first', () => {
		const first = txn('2026-08-20', -1000);
		const second = txn('2026-08-20', -2000);
		const tape = buildTape([first, second], { openingBalance: OPENING, today: '2026-08-20' });

		expect(tape[0]!.days[0]!.rows.map((r) => r.txn.id)).toEqual([second.id, first.id]);
	});

	it('shows today even with no transactions at all', () => {
		const tape = buildTape([], { openingBalance: OPENING, today: '2026-08-20' });
		expect(tape).toHaveLength(1);
		expect(tape[0]!.days).toEqual([
			expect.objectContaining({ date: '2026-08-20', rows: [], balance: OPENING })
		]);
	});

	it('caps how many gap days it will materialise', () => {
		const tape = buildTape([txn('2020-01-01', -5000)], {
			openingBalance: OPENING,
			today: '2026-08-20',
			maxGapDays: 30
		});

		const total = tape.reduce((n, month) => n + month.days.length, 0);
		expect(total).toBe(31);
	});
});

describe('balanceOf()', () => {
	it('is the opening balance plus every movement', () => {
		expect(balanceOf(OPENING, [txn('2026-08-01', -5000), txn('2026-08-02', 2500)])).toBe(97500);
	});
});

describe('recentPayees()', () => {
	it('lists distinct payees, most recent first, keeping original casing', () => {
		const rows = [
			txn('2026-08-01', -1000, { payee: 'Albert' }),
			txn('2026-08-02', -1000, { payee: 'Billa' }),
			txn('2026-08-03', -1000, { payee: 'albert' })
		];
		expect(recentPayees(rows)).toEqual(['albert', 'Billa']);
	});

	it('ignores blank payees', () => {
		expect(recentPayees([txn('2026-08-01', -1000, { payee: '  ' })])).toEqual([]);
	});
});

describe('categoryOrder()', () => {
	it('puts recently used categories first, then the rest in configured order', () => {
		const rows = [
			txn('2026-08-01', -1000, { categoryId: 'c-food' }),
			txn('2026-08-02', -1000, { categoryId: 'c-fuel' })
		];
		expect(categoryOrder(rows, ['c-food', 'c-fuel', 'c-fun'])).toEqual([
			'c-fuel',
			'c-food',
			'c-fun'
		]);
	});

	it('ignores categories that no longer exist', () => {
		const rows = [txn('2026-08-01', -1000, { categoryId: 'c-gone' })];
		expect(categoryOrder(rows, ['c-food'])).toEqual(['c-food']);
	});
});

describe('categoryRanking()', () => {
	it('ranks by how often a bucket is used, not by what was touched last', () => {
		const rows = [
			txn('2026-08-01', -1000, { categoryId: 'c-food' }),
			txn('2026-08-02', -1000, { categoryId: 'c-food' }),
			txn('2026-08-03', -1000, { categoryId: 'c-food' }),
			txn('2026-08-04', -1000, { categoryId: 'c-fuel' })
		];
		// c-fuel is the most recent, c-food is the habit. The habit wins.
		expect(categoryRanking(rows, ['c-fun', 'c-fuel', 'c-food'])).toEqual([
			'c-food',
			'c-fuel',
			'c-fun'
		]);
	});

	it('breaks a tie on how recently it was used', () => {
		const older = txn('2026-08-01', -1000, { categoryId: 'c-food' });
		const newer = txn('2026-08-02', -1000, { categoryId: 'c-fuel' });
		expect(categoryRanking([older, newer], ['c-food', 'c-fuel'])).toEqual(['c-fuel', 'c-food']);
	});

	it('keeps configured order for buckets never used', () => {
		expect(categoryRanking([], ['c-a', 'c-b', 'c-c'])).toEqual(['c-a', 'c-b', 'c-c']);
	});

	it('ignores deleted rows', () => {
		const rows = [txn('2026-08-01', -1000, { categoryId: 'c-fuel', isDeleted: true })];
		expect(categoryRanking(rows, ['c-food', 'c-fuel'])).toEqual(['c-food', 'c-fuel']);
	});
});
