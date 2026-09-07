import { describe, expect, it } from 'vitest';
import {
	daysSinceReconciled,
	describeDelta,
	isClean,
	lastReconciliation,
	reconcileDelta
} from './reconcile';
import { minor } from './money';
import type { Reconciliation } from './types';

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

function reconciliation(
	id: string,
	date: string,
	patch: Partial<Reconciliation> = {}
): Reconciliation {
	return {
		id,
		accountId: 'acc',
		date,
		statementBalance: minor(100_00),
		computedBalance: minor(100_00),
		adjustmentTxnId: null,
		...SYNCED,
		...patch
	};
}

describe('reconcileDelta', () => {
	it('is clean when the two agree', () => {
		const delta = reconcileDelta({ computed: minor(14_145_00), statement: minor(14_145_00) });

		expect(delta.amount).toBe(0);
		expect(delta.direction).toBe('clean');
		expect(isClean(delta)).toBe(true);
	});

	it('reads a bank holding less as an unrecorded outflow', () => {
		// The ledger thinks there is more than there is: money left without being
		// written down. The row that fixes it is negative.
		const delta = reconcileDelta({ computed: minor(14_145_00), statement: minor(13_945_00) });

		expect(delta.amount).toBe(-200_00);
		expect(delta.direction).toBe('missing-outflow');
		expect(delta.adjustment).toBe(-200_00);
	});

	it('reads a bank holding more as an unrecorded inflow', () => {
		const delta = reconcileDelta({ computed: minor(14_145_00), statement: minor(14_345_00) });

		expect(delta.amount).toBe(200_00);
		expect(delta.direction).toBe('missing-inflow');
		expect(delta.adjustment).toBe(200_00);
	});

	it('produces an adjustment that closes the gap rather than doubling it', () => {
		const computed = minor(14_145_00);
		const statement = minor(13_945_00);

		const delta = reconcileDelta({ computed, statement });

		// The sign is the whole point of the function: applying the adjustment to
		// the ledger has to land exactly on the statement.
		expect(computed + delta.adjustment).toBe(statement);
	});

	it('works across zero and into the negative', () => {
		const delta = reconcileDelta({ computed: minor(-500_00), statement: minor(-1_200_00) });

		expect(delta.amount).toBe(-700_00);
		// The adjustment still lands exactly on the statement.
		expect(minor(-500_00) + delta.amount).toBe(-1_200_00);
	});

	it('has no tolerance — nine haléře out is still out', () => {
		const delta = reconcileDelta({ computed: minor(14_145_00), statement: minor(14_145_09) });

		expect(isClean(delta)).toBe(false);
		expect(delta.amount).toBe(9);
	});
});

describe('describeDelta', () => {
	it('says so plainly when it agrees', () => {
		expect(describeDelta(reconcileDelta({ computed: minor(100), statement: minor(100) }))).toBe(
			'Sedí to na korunu.'
		);
	});

	it('names the direction in the reader’s terms, not the sign’s', () => {
		const short = describeDelta(
			reconcileDelta({ computed: minor(14_145_00), statement: minor(13_945_00) })
		);
		expect(short).toContain('míň');
		expect(short).toContain('odešlo');

		const over = describeDelta(
			reconcileDelta({ computed: minor(14_145_00), statement: minor(14_345_00) })
		);
		expect(over).toContain('víc');
		expect(over).toContain('přišlo');
	});

	it('states the gap as a positive amount, whichever way it points', () => {
		const short = describeDelta(
			reconcileDelta({ computed: minor(14_145_00), statement: minor(13_945_00) })
		);

		expect(short).not.toContain('-');
		expect(short).not.toContain('−');
	});
});

describe('lastReconciliation', () => {
	it('is null when the account has never been checked', () => {
		expect(lastReconciliation([], 'acc')).toBeNull();
	});

	it('takes the greatest date', () => {
		const rows = [
			reconciliation('a', '2026-06-30'),
			reconciliation('c', '2026-08-31'),
			reconciliation('b', '2026-07-31')
		];

		expect(lastReconciliation(rows, 'acc')?.id).toBe('c');
	});

	it('breaks a same-date tie on updatedAt — the correction wins', () => {
		const rows = [
			reconciliation('first', '2026-08-31', { updatedAt: '2026-08-31T09:00:00.000Z' }),
			reconciliation('second', '2026-08-31', { updatedAt: '2026-08-31T09:05:00.000Z' })
		];

		expect(lastReconciliation(rows, 'acc')?.id).toBe('second');
	});

	it('ignores another account, and anything deleted', () => {
		const rows = [
			reconciliation('other', '2026-09-30', { accountId: 'nope' }),
			reconciliation('gone', '2026-09-15', { isDeleted: true }),
			reconciliation('mine', '2026-08-31')
		];

		expect(lastReconciliation(rows, 'acc')?.id).toBe('mine');
	});
});

describe('daysSinceReconciled', () => {
	it('is null when it never has been', () => {
		expect(daysSinceReconciled([], 'acc', '2026-08-27')).toBeNull();
	});

	it('counts the days', () => {
		const rows = [reconciliation('a', '2026-07-31')];

		expect(daysSinceReconciled(rows, 'acc', '2026-08-27')).toBe(27);
	});

	it('is zero on the day itself', () => {
		expect(daysSinceReconciled([reconciliation('a', '2026-08-27')], 'acc', '2026-08-27')).toBe(0);
	});
});
