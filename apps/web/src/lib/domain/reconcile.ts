/**
 * Reconciliation — the ledger against the bank.
 *
 * `PROJECT-PLAN.md` §1.2 asks for "a **reliable** ledger — reconciled against
 * real bank balances, no silent gaps", and until this shipped that sentence had
 * no mechanism behind it. The `Reconciliation` entity had been in the schema
 * since v1 with nothing ever writing to it.
 *
 * The whole idea is one subtraction. What matters is what is done with the
 * answer:
 *
 * **A delta is not an error, it is a missing transaction.** The bank is right
 * about the balance and the ledger is right about the reasons; a difference
 * means something happened that never got recorded. So the fix is to *record
 * it*, as an ordinary row, rather than to overwrite the balance with the bank's
 * figure — which would hide the gap the reconciliation just found.
 *
 * **The adjustment is one-off by construction.** A correction is not the running
 * cost of a month, and letting it into the average would make the very number
 * this exercise exists to protect less trustworthy.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { formatMoney, minor, sub, type Minor } from './money';
import type { IsoDate } from './datetime';
import type { Reconciliation } from './types';

export interface DeltaInput {
	/** What the ledger says: opening balance plus every row. */
	computed: Minor;
	/** What the bank says, typed off the statement. */
	statement: Minor;
}

export type DeltaDirection = 'clean' | 'missing-outflow' | 'missing-inflow';

export interface Delta {
	/** `statement − computed`. Positive: the bank holds more than we thought. */
	amount: Minor;
	direction: DeltaDirection;
	/** The signed amount an adjustment row would carry. Same as `amount`. */
	adjustment: Minor;
}

/**
 * The subtraction, and what it means.
 *
 * `statement − computed`, in that order, so the sign of the answer is the sign
 * of the row that would fix it: the bank holding **less** than the ledger
 * expects means an unrecorded *outflow*, and an unrecorded outflow is a negative
 * row. Getting this backwards produces an adjustment that doubles the error
 * instead of closing it, which is why it is one function with a name.
 */
export function reconcileDelta({ computed, statement }: DeltaInput): Delta {
	const amount = sub(statement, computed);

	return {
		amount,
		adjustment: amount,
		direction: amount === 0 ? 'clean' : amount < 0 ? 'missing-outflow' : 'missing-inflow'
	};
}

/** One sentence, in the app's own voice, about what the delta means. */
export function describeDelta(delta: Delta): string {
	if (delta.direction === 'clean') return 'Sedí to na korunu.';

	const size = formatMoney(minor(Math.abs(delta.amount)));
	return delta.direction === 'missing-outflow'
		? `Na účtu je o ${size} míň, než sedí ve výpisu — něco odešlo a není to zapsané.`
		: `Na účtu je o ${size} víc, než sedí ve výpisu — něco přišlo a není to zapsané.`;
}

/** What the adjustment row is called. Never blank: a nameless row is a mystery. */
export const ADJUSTMENT_PAYEE = 'Vyrovnání s bankou';

/**
 * A tolerance, and it is exactly zero.
 *
 * There is no "close enough" here. §11 makes the P3 gate "the first month closes
 * with a zero reconciliation delta", and a tolerance is how a small permanent
 * error becomes invisible and then becomes normal. Nine haléře out is still out.
 */
export function isClean(delta: Delta): boolean {
	return delta.amount === 0;
}

/** The most recent reconciliation of an account, or null. */
export function lastReconciliation(
	rows: readonly Reconciliation[],
	accountId: string
): Reconciliation | null {
	const live = rows.filter((row) => !row.isDeleted && row.accountId === accountId);
	if (live.length === 0) return null;

	return [...live].sort((a, b) => {
		const byDate = b.date.localeCompare(a.date);
		return byDate !== 0 ? byDate : b.updatedAt.localeCompare(a.updatedAt);
	})[0]!;
}

/** Days since the account was last checked against a statement. Null if never. */
export function daysSinceReconciled(
	rows: readonly Reconciliation[],
	accountId: string,
	today: IsoDate
): number | null {
	const last = lastReconciliation(rows, accountId);
	if (!last) return null;

	const from = Date.parse(`${last.date}T00:00:00Z`);
	const to = Date.parse(`${today}T00:00:00Z`);
	return Math.round((to - from) / 86_400_000);
}
