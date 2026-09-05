import { describe, expect, it } from 'vitest';
import {
	MIN_PAYEE_QUERY,
	balanceOf,
	balancesByCurrency,
	buildTape,
	categoryOrder,
	categoryRanking,
	recentPayees,
	suggestPayees
} from './ledger';
import { minor, type Minor } from './money';
import type { Account, Txn } from './types';

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

describe('balancesByCurrency()', () => {
	function account(
		id: string,
		currency: string,
		opening: number,
		patch: Partial<Account> = {}
	): Account {
		return {
			id,
			name: id,
			kind: 'checking' as const,
			openingBalance: minor(opening),
			openingDate: '2026-01-01',
			pockets: [],
			currency,
			isArchived: false,
			sortOrder: 0,
			updatedAt: '2026-08-01T10:00:00.000Z',
			deviceId: 'dev-1',
			isDeleted: false,
			...patch
		};
	}

	const kb = account('kb', 'CZK', 10_000_00, { sortOrder: 0 });
	const revolutCzk = account('rev-czk', 'CZK', 5_000_00, { sortOrder: 1 });
	const revolutEur = account('rev-eur', 'EUR', 100_00, { sortOrder: 2 });

	it('sums accounts inside a currency and names each half of the sum', () => {
		const groups = balancesByCurrency(
			[kb, revolutCzk],
			[
				txn('2026-08-01', -2_000_00, { accountId: 'kb' }),
				txn('2026-08-02', 3_000_00, { accountId: 'rev-czk' })
			]
		);

		expect(groups).toHaveLength(1);
		const [czk] = groups;
		expect(czk!.code).toBe('CZK');
		expect(czk!.total).toBe(16_000_00);
		expect(czk!.lines.map((line) => [line.name, line.amount])).toEqual([
			['kb', 8_000_00],
			['rev-czk', 8_000_00]
		]);
	});

	it('breaks a balance into the bank account and each pocket on it — Q50', () => {
		const withPocket = account('kb', 'CZK', 15_000_00, {
			name: 'Běžný účet',
			pockets: [{ id: 'p1', name: 'Revolut', amount: minor(5_000_00) }]
		});

		const untouched = balancesByCurrency([withPocket], []);
		expect(untouched[0]!.total).toBe(20_000_00);

		// Spending moves the account's own line only: a pocket is opening money,
		// and nothing spent afterwards is attributed back to the card it came from.
		const [czk] = balancesByCurrency(
			[withPocket],
			[txn('2026-08-01', -2_000_00, { accountId: 'kb' })]
		);
		expect(czk!.total).toBe(18_000_00);
		expect(czk!.lines.map((line) => [line.name, line.amount, line.pocket?.id ?? null])).toEqual([
			['Běžný účet', 13_000_00, null],
			['Revolut', 5_000_00, 'p1']
		]);
	});

	it('never adds across currencies — a euro account is its own group', () => {
		const groups = balancesByCurrency(
			[kb, revolutEur],
			[txn('2026-08-01', -30_00, { accountId: 'rev-eur' })]
		);

		expect(groups.map((g) => [g.code, g.total])).toEqual([
			['CZK', 10_000_00],
			['EUR', 70_00]
		]);
	});

	it('is the opening figure alone for an account with no rows', () => {
		const [czk] = balancesByCurrency([kb], []);
		expect(czk!.lines[0]!.amount).toBe(10_000_00);
	});

	it('ignores soft-deleted rows and archived accounts', () => {
		const archived = account('old', 'CZK', 99_000_00, { isArchived: true, sortOrder: 9 });
		const groups = balancesByCurrency(
			[kb, archived],
			[
				txn('2026-08-01', -500_00, { accountId: 'kb', isDeleted: true }),
				txn('2026-08-01', -500_00, { accountId: 'old' })
			]
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]!.lines.map((line) => line.name)).toEqual(['kb']);
		expect(groups[0]!.total).toBe(10_000_00);
	});

	it('is empty when there are no live accounts', () => {
		expect(balancesByCurrency([], [txn('2026-08-01', -1_00)])).toEqual([]);
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

describe('suggestPayees()', () => {
	const history = [
		txn('2026-03-02', -6500, { payee: 'ranní kafe' }),
		txn('2026-05-11', -24900, { payee: 'Albert' }),
		txn('2026-07-19', -12000, { payee: 'Káva u Petra' }),
		txn('2026-08-01', -9000, { payee: 'Kafe Jedna' }),
		txn('2026-08-02', -3000, { payee: 'albert' })
	];

	it('stays shut until the third character', () => {
		expect(MIN_PAYEE_QUERY).toBe(3);
		expect(suggestPayees(history, '')).toEqual([]);
		expect(suggestPayees(history, 'k')).toEqual([]);
		expect(suggestPayees(history, 'ka')).toEqual([]);
		expect(suggestPayees(history, 'kaf')).not.toEqual([]);
	});

	it('matches the start of any word, folding case and diacritics', () => {
		expect(suggestPayees(history, 'kaf')).toEqual(['Kafe Jedna', 'ranní kafe']);
		expect(suggestPayees(history, 'káv')).toEqual(['Káva u Petra']);
		expect(suggestPayees(history, 'PET')).toEqual(['Káva u Petra']);
	});

	it('does not match inside a word', () => {
		expect(suggestPayees(history, 'afe')).toEqual([]);
	});

	it('searches the whole history, most recent first, in the casing last typed', () => {
		expect(suggestPayees(history, 'alb')).toEqual(['albert']);
		// The March row is found even though it is the oldest thing in the ledger.
		expect(suggestPayees(history, 'ran')).toEqual(['ranní kafe']);
	});

	it('never offers a transfer leg, and finds nothing in an empty ledger', () => {
		const rows = [
			txn('2026-08-03', -100000, { payee: 'Převod → Revolut', transferPairId: 'pair' })
		];
		expect(suggestPayees(rows, 'pře')).toEqual([]);
		expect(suggestPayees([], 'alb')).toEqual([]);
	});

	it('cuts the list at the limit', () => {
		const many = Array.from({ length: 12 }, (_, i) =>
			txn(`2026-08-${String(i + 1).padStart(2, '0')}`, -100, { payee: `Kafe ${i}` })
		);
		expect(suggestPayees(many, 'kaf')).toHaveLength(8);
		expect(suggestPayees(many, 'kaf', 3)).toHaveLength(3);
	});
});
