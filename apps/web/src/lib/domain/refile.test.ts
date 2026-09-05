import { describe, expect, it } from 'vitest';
import { dumpingGround, refileCandidates, refileTargets, summariseDrain } from './refile';
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
		icon: 'tag',
		color: 'stone',
		...SYNCED,
		...patch
	};
}

let seq = 0;
function txn(payee: string, amount: number, patch: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `t${seq}`,
		accountId: 'acc',
		date: '2026-08-10',
		amount: minor(amount),
		categoryId: 'other',
		payee,
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		createdAt: '2026-08-10T10:00:00.000Z',
		isOneOff: false,
		shares: [],
		scheduleId: null,
		...SYNCED,
		...patch
	};
}

const categories = [
	category('other', 'OSTATNÍ'),
	category('food', 'JÍDLO'),
	category('groceries', 'POTRAVINY', { spendType: 'need' }),
	category('income', 'PŘÍJEM', { isIncome: true, spendType: 'save' })
];

const base = { categories, month: '2026-08', categoryId: 'other' };

describe('refileCandidates', () => {
	it('suggests a bucket from the same vocabulary the entry screen uses', () => {
		const rows = [txn('oběd v menze', -19900)];

		const [candidate] = refileCandidates({ ...base, txns: rows });

		expect(candidate?.suggestion?.name).toBe('JÍDLO');
	});

	it('still lists a row it cannot place', () => {
		// The vocabulary knows Petr's words and nothing else. A row it cannot
		// place is the most likely junk of all — hiding it would leave the bucket
		// looking drained when it is not.
		const rows = [txn('opak. obj', -1_707_400)];

		const [candidate] = refileCandidates({ ...base, txns: rows });

		expect(candidate?.txn.payee).toBe('opak. obj');
		expect(candidate?.suggestion).toBeNull();
	});

	it('puts the biggest row first', () => {
		const rows = [txn('kafe', -4900), txn('objednávka', -629_100), txn('svačina', -8900)];

		const order = refileCandidates({ ...base, txns: rows }).map((c) => c.txn.payee);

		expect(order).toEqual(['objednávka', 'svačina', 'kafe']);
	});

	it('only looks at the bucket being drained', () => {
		const rows = [txn('oběd', -19900), txn('rohlík', -8900, { categoryId: 'groceries' })];

		const found = refileCandidates({ ...base, txns: rows });

		expect(found).toHaveLength(1);
		expect(found[0]?.txn.payee).toBe('oběd');
	});

	it('only looks at the month being drained', () => {
		const rows = [txn('oběd', -19900), txn('starý oběd', -19900, { date: '2026-07-10' })];

		expect(refileCandidates({ ...base, txns: rows })).toHaveLength(1);
	});

	it('leaves an inflow alone — it is a refund, and §6.1 already rules on those', () => {
		const rows = [txn('vratka', 125_000), txn('oběd', -19900)];

		const found = refileCandidates({ ...base, txns: rows });

		expect(found.map((c) => c.txn.payee)).toEqual(['oběd']);
	});

	it('ignores a deleted row', () => {
		const rows = [txn('oběd', -19900, { isDeleted: true })];

		expect(refileCandidates({ ...base, txns: rows })).toEqual([]);
	});

	it('never suggests the bucket the row is already in', () => {
		// A row literally described "ostatní" must not be offered a move to
		// OSTATNÍ, which is where it already sits.
		const rows = [txn('ostatní', -50000)];

		expect(refileCandidates({ ...base, txns: rows })[0]?.suggestion).toBeNull();
	});

	it('does not suggest an archived bucket', () => {
		const archived = [
			category('other', 'OSTATNÍ'),
			category('food', 'JÍDLO', { isArchived: true })
		];

		const [candidate] = refileCandidates({
			...base,
			categories: archived,
			txns: [txn('oběd', -19900)]
		});

		expect(candidate?.suggestion).toBeNull();
	});
});

describe('summariseDrain', () => {
	it('adds the rows up as a positive magnitude', () => {
		const found = refileCandidates({
			...base,
			txns: [txn('oběd', -19900), txn('objednávka', -629_100)]
		});

		expect(summariseDrain(found)).toEqual({
			remaining: 2,
			total: 649_000,
			suggested: 1
		});
	});

	it('is empty on an empty bucket', () => {
		expect(summariseDrain([])).toEqual({ remaining: 0, total: 0, suggested: 0 });
	});
});

describe('dumpingGround', () => {
	it('finds OSTATNÍ however it is accented or cased', () => {
		expect(dumpingGround(categories)?.id).toBe('other');
		expect(dumpingGround([category('x', 'ostatni')])?.id).toBe('x');
	});

	it('is null when the ledger has no such bucket', () => {
		expect(dumpingGround([category('food', 'JÍDLO')])).toBeNull();
	});

	it('ignores an archived one', () => {
		expect(dumpingGround([category('other', 'OSTATNÍ', { isArchived: true })])).toBeNull();
	});
});

describe('refileTargets', () => {
	it('offers every live bucket except the one being drained', () => {
		expect(refileTargets(categories, 'other').map((c) => c.name)).toEqual(['JÍDLO', 'POTRAVINY']);
	});

	it('leaves income out unless asked', () => {
		expect(refileTargets(categories, 'other', { income: true }).map((c) => c.name)).toContain(
			'PŘÍJEM'
		);
	});
});
