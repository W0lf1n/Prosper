/**
 * Money other people owe you.
 *
 * The rule, decided 2026-08-23: you paid the whole thing, so the whole thing is
 * in the balance. An outstanding share changes nothing until it actually
 * arrives. That way the balance never shows money you cannot spend, and the
 * spreadsheet's habit of booking a reimbursement as income — which inflated both
 * income and spending at once — has no way to happen.
 *
 * Pure (§11.6).
 */

import { ZERO, abs, sum, type Minor } from './money';
import type { Txn } from './types';

export interface Receivable {
	txn: Txn;
	/** Still outstanding. Positive. */
	amount: Minor;
	who: string;
	/** The expense it came out of. */
	spent: Minor;
}

export function isOpenReceivable(txn: Txn): boolean {
	return (
		!txn.isDeleted && txn.owedAmount !== null && txn.owedAmount > 0 && txn.settledByTxnId === null
	);
}

/** Everything still outstanding, largest first. */
export function openReceivables(txns: readonly Txn[]): Receivable[] {
	return txns
		.filter(isOpenReceivable)
		.map((txn) => ({
			txn,
			amount: abs(txn.owedAmount!),
			who: txn.owedBy?.trim() || 'někdo',
			spent: abs(txn.amount)
		}))
		.sort((a, b) => b.amount - a.amount);
}

export function totalOwed(txns: readonly Txn[]): Minor {
	const open = openReceivables(txns);
	return open.length === 0 ? ZERO : sum(open.map((r) => r.amount));
}

/** Outstanding totals per person, largest first. */
export function owedByPerson(txns: readonly Txn[]): { who: string; amount: Minor }[] {
	const totals = new Map<string, number>();
	for (const receivable of openReceivables(txns)) {
		totals.set(receivable.who, (totals.get(receivable.who) ?? 0) + receivable.amount);
	}
	return [...totals.entries()]
		.map(([who, amount]) => ({ who, amount: amount as Minor }))
		.sort((a, b) => b.amount - a.amount);
}

/**
 * What this expense really cost you once the share comes back.
 *
 * Reporting only — never the balance. The balance shows what left the account.
 */
export function netOf(txn: Txn): Minor {
	if (txn.owedAmount === null) return txn.amount;
	const net = txn.amount + abs(txn.owedAmount);
	// A share larger than the expense would flip the sign; clamp rather than lie.
	return (txn.amount < 0 ? Math.min(net, 0) : Math.max(net, 0)) as Minor;
}
