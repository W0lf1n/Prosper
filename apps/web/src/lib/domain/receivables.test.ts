import { describe, expect, it } from 'vitest';
import {
	isOpenReceivable,
	netOf,
	openReceivables,
	owedByPerson,
	sharesOf,
	totalOwed
} from './receivables';
import { minor } from './money';
import type { Txn, TxnShare } from './types';

let seq = 0;

function txn(amount: number, extra: Partial<Txn> = {}): Txn {
	seq += 1;
	return {
		id: `txn-${seq}`,
		accountId: 'acc-1',
		date: '2026-08-20',
		amount: minor(amount),
		categoryId: 'cat-bydlení',
		payee: 'plyn',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		createdAt: '2026-08-20T10:00:00.000Z',
		updatedAt: '2026-08-20T10:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

function share(amount: number, who = '', extra: Partial<TxnShare> = {}): TxnShare {
	seq += 1;
	return { id: `share-${seq}`, who, amount: minor(amount), settledByTxnId: null, ...extra };
}

describe('open receivables', () => {
	it('counts a share that has not come back yet', () => {
		const gas = txn(-250000, { shares: [share(125000, 'Zůza')] });
		expect(isOpenReceivable(gas)).toBe(true);
		expect(totalOwed([gas])).toBe(125000);
	});

	it('drops it once the money arrives', () => {
		const gas = txn(-250000, {
			shares: [share(125000, 'Zůza', { settledByTxnId: 'txn-repayment' })]
		});
		expect(isOpenReceivable(gas)).toBe(false);
		expect(totalOwed([gas])).toBe(0);
	});

	it('lists every payer of one expense separately — Q47', () => {
		const netflix = txn(-39900, { shares: [share(13300, 'Kerhy'), share(13300, 'Zůza')] });
		const open = openReceivables([netflix]);
		expect(open).toHaveLength(2);
		expect(open.map((r) => [r.who, r.amount])).toEqual([
			['Kerhy', 13300],
			['Zůza', 13300]
		]);
		// Both point back at the same expense, each through its own share.
		expect(open[0]!.txn.id).toBe(netflix.id);
		expect(open[0]!.share.id).not.toBe(open[1]!.share.id);
	});

	it('one friend paying up says nothing about the other', () => {
		const netflix = txn(-39900, {
			shares: [share(13300, 'Kerhy', { settledByTxnId: 'txn-x' }), share(13300, 'Zůza')]
		});
		expect(isOpenReceivable(netflix)).toBe(true);
		expect(totalOwed([netflix])).toBe(13300);
		expect(openReceivables([netflix])[0]!.who).toBe('Zůza');
	});

	it('ignores deleted rows and plain expenses', () => {
		const deleted = txn(-250000, { shares: [share(125000)], isDeleted: true });
		expect(totalOwed([deleted, txn(-99900)])).toBe(0);
	});

	it('lists the largest debt first, with who owes it', () => {
		const rows = [
			txn(-250000, { shares: [share(125000, 'Zůza')] }),
			txn(-100000, { shares: [share(50000, 'Kerhy')] })
		];
		expect(openReceivables(rows).map((r) => [r.who, r.amount])).toEqual([
			['Zůza', 125000],
			['Kerhy', 50000]
		]);
	});

	it('adds up per person across several expenses', () => {
		const rows = [
			txn(-250000, { shares: [share(125000, 'Zůza')] }),
			txn(-150000, { shares: [share(75000, 'Zůza')] }),
			txn(-100000, { shares: [share(50000, 'Kerhy')] })
		];
		expect(owedByPerson(rows)).toEqual([
			{ who: 'Zůza', amount: 200000 },
			{ who: 'Kerhy', amount: 50000 }
		]);
	});

	it('falls back to "někdo" when the name was left blank', () => {
		const rows = [txn(-250000, { shares: [share(125000, '  ')] })];
		expect(openReceivables(rows)[0]!.who).toBe('někdo');
	});
});

describe('sharesOf() — the legacy fallback', () => {
	/** A row as an older build wrote it: the single trio, no array at all. */
	function legacyTxn(owedAmount: number | null, owedBy: string | null, settled: string | null) {
		const row: Record<string, unknown> = { ...txn(-250000) };
		delete row.shares;
		row.owedAmount = owedAmount;
		row.owedBy = owedBy;
		row.settledByTxnId = settled;
		return row as unknown as Txn;
	}

	it('synthesises the single share of a pre-v9 row', () => {
		const old = legacyTxn(125000, 'Zůza', null);
		expect(sharesOf(old)).toEqual([
			{ id: 'legacy', who: 'Zůza', amount: 125000, settledByTxnId: null }
		]);
		expect(isOpenReceivable(old)).toBe(true);
		expect(totalOwed([old])).toBe(125000);
	});

	it('carries the old settlement through', () => {
		const old = legacyTxn(125000, 'Zůza', 'txn-repayment');
		expect(sharesOf(old)[0]!.settledByTxnId).toBe('txn-repayment');
		expect(isOpenReceivable(old)).toBe(false);
	});

	it('reads an unshared legacy row as an empty list', () => {
		expect(sharesOf(legacyTxn(null, null, null))).toEqual([]);
	});

	it('prefers the array when a migrated row still carries the trio', () => {
		const migrated = txn(-250000, { shares: [share(100000, 'Zůza')] }) as Txn &
			Record<string, unknown>;
		migrated.owedAmount = 125000;
		migrated.owedBy = 'stará hodnota';
		expect(totalOwed([migrated as Txn])).toBe(100000);
	});
});

describe('netOf()', () => {
	it('reports what the expense really cost, without touching the balance', () => {
		const gas = txn(-250000, { shares: [share(125000, 'Zůza')] });
		expect(netOf(gas)).toBe(-125000);
		expect(gas.amount).toBe(-250000); // the balance still sees the whole thing
	});

	it('subtracts every payer of a split expense', () => {
		const netflix = txn(-39900, { shares: [share(13300, 'Kerhy'), share(13300, 'Zůza')] });
		expect(netOf(netflix)).toBe(-13300);
	});

	it('leaves an ordinary expense alone', () => {
		expect(netOf(txn(-99900))).toBe(-99900);
	});

	it('clamps rather than flipping the sign on nonsense shares', () => {
		expect(netOf(txn(-100000, { shares: [share(500000)] }))).toBe(0);
	});
});
