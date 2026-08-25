import { describe, expect, it } from 'vitest';
import { isOpenReceivable, netOf, openReceivables, owedByPerson, totalOwed } from './receivables';
import { minor } from './money';
import type { Txn } from './types';

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
		owedAmount: null,
		owedBy: null,
		settledByTxnId: null,
		createdAt: '2026-08-20T10:00:00.000Z',
		updatedAt: '2026-08-20T10:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

describe('open receivables', () => {
	it('counts a share that has not come back yet', () => {
		const gas = txn(-250000, { owedAmount: minor(125000), owedBy: 'Zůza' });
		expect(isOpenReceivable(gas)).toBe(true);
		expect(totalOwed([gas])).toBe(125000);
	});

	it('drops it once the money arrives', () => {
		const gas = txn(-250000, {
			owedAmount: minor(125000),
			owedBy: 'Zůza',
			settledByTxnId: 'txn-repayment'
		});
		expect(isOpenReceivable(gas)).toBe(false);
		expect(totalOwed([gas])).toBe(0);
	});

	it('ignores deleted rows and plain expenses', () => {
		const deleted = txn(-250000, { owedAmount: minor(125000), isDeleted: true });
		expect(totalOwed([deleted, txn(-99900)])).toBe(0);
	});

	it('lists the largest debt first, with who owes it', () => {
		const rows = [
			txn(-250000, { owedAmount: minor(125000), owedBy: 'Zůza' }),
			txn(-100000, { owedAmount: minor(50000), owedBy: 'Kerhy' })
		];
		expect(openReceivables(rows).map((r) => [r.who, r.amount])).toEqual([
			['Zůza', 125000],
			['Kerhy', 50000]
		]);
	});

	it('adds up per person across several expenses', () => {
		const rows = [
			txn(-250000, { owedAmount: minor(125000), owedBy: 'Zůza' }),
			txn(-150000, { owedAmount: minor(75000), owedBy: 'Zůza' }),
			txn(-100000, { owedAmount: minor(50000), owedBy: 'Kerhy' })
		];
		expect(owedByPerson(rows)).toEqual([
			{ who: 'Zůza', amount: 200000 },
			{ who: 'Kerhy', amount: 50000 }
		]);
	});

	it('falls back to "někdo" when the name was left blank', () => {
		const rows = [txn(-250000, { owedAmount: minor(125000), owedBy: '  ' })];
		expect(openReceivables(rows)[0]!.who).toBe('někdo');
	});
});

describe('netOf()', () => {
	it('reports what the expense really cost, without touching the balance', () => {
		const gas = txn(-250000, { owedAmount: minor(125000), owedBy: 'Zůza' });
		expect(netOf(gas)).toBe(-125000);
		expect(gas.amount).toBe(-250000); // the balance still sees the whole thing
	});

	it('leaves an ordinary expense alone', () => {
		expect(netOf(txn(-99900))).toBe(-99900);
	});

	it('clamps rather than flipping the sign on a nonsense share', () => {
		expect(netOf(txn(-100000, { owedAmount: minor(500000) }))).toBe(0);
	});
});
