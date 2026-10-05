/**
 * Money other people owe you.
 *
 * The rule, decided 2026-08-23: you paid the whole thing, so the whole thing is
 * in the balance. An outstanding share changes nothing until it actually
 * arrives. That way the balance never shows money you cannot spend, and the
 * spreadsheet's habit of booking a reimbursement as income — which inflated both
 * income and spending at once — has no way to happen.
 *
 * Since Q47 an expense can carry more than one share — Netflix paid whole,
 * two friends each returning their slice — and every share settles on its own.
 *
 * Since Q82 what comes back may be more than what went out: the friend who
 * owes 10 Kč and sends 11 as a thank-you. Nothing caps a share at its
 * expense, and a share can be settled with a different figure than the one
 * it was written with — the figure that arrived is the one that is kept.
 *
 * Pure (§11.6).
 */

import { ZERO, abs, minor, mulRatio, parseAmount, sum, type Minor } from './money';
import type { Txn, TxnShare } from './types';

/**
 * The id a legacy row's single share is given when it is synthesised — here
 * and in the v9 migration, which must agree so the same share never changes
 * identity between a migrated row and a freshly-read one.
 */
export const LEGACY_SHARE_ID = 'legacy';

/**
 * How many people can pay one expense back — Petr's own ceiling, 2026-08-30.
 *
 * Not an architectural limit: a share is a few dozen bytes on the row and
 * nothing indexes it. The cap exists because a list with no ceiling is a form
 * that can be scrolled into absurdity, and a payment split more than ten ways
 * is not a payment this app is for. The sheets stop offering "Přidat dalšího"
 * at it; the repo clamps to it for any other caller.
 */
export const MAX_SHARES = 10;

/** The single-share trio rows carried before v9. Never part of the model
    again — only read, never written, and only through `sharesOf`. */
interface LegacyOwed {
	owedAmount?: Minor | null;
	owedBy?: string | null;
	settledByTxnId?: string | null;
}

/**
 * The one way to read a row's shares.
 *
 * A row written by this build has `shares`. A row written by an older one — an
 * old backup merged in, an unpaired device pushing after an update — has the
 * single `owedAmount` / `owedBy` trio and no array, forever: the v9 migration
 * only reaches rows that were present when it ran. So the fallback is not
 * transitional code, it is the read side of the format.
 */
export function sharesOf(txn: Txn): TxnShare[] {
	if (Array.isArray(txn.shares)) return txn.shares;
	const legacy = txn as Txn & LegacyOwed;
	if (!legacy.owedAmount) return [];
	return [
		{
			id: LEGACY_SHARE_ID,
			who: legacy.owedBy ?? '',
			amount: abs(legacy.owedAmount),
			settledByTxnId: legacy.settledByTxnId ?? null
		}
	];
}

export function isOpenShare(share: TxnShare): boolean {
	return share.amount > 0 && share.settledByTxnId === null;
}

/** Does anybody still owe anything on this row? */
export function isOpenReceivable(txn: Txn): boolean {
	return !txn.isDeleted && sharesOf(txn).some(isOpenShare);
}

export interface Receivable {
	txn: Txn;
	/** The one slice this entry is about — settled independently of the rest. */
	share: TxnShare;
	/** Still outstanding. Positive. */
	amount: Minor;
	who: string;
	/** The expense it came out of. */
	spent: Minor;
}

/** Everything still outstanding — one entry per open share, largest first. */
export function openReceivables(txns: readonly Txn[]): Receivable[] {
	return txns
		.filter((txn) => !txn.isDeleted)
		.flatMap((txn) =>
			sharesOf(txn)
				.filter(isOpenShare)
				.map((share) => ({
					txn,
					share,
					amount: abs(share.amount),
					who: share.who.trim() || 'někdo',
					spent: abs(txn.amount)
				}))
		)
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
 * What this expense really cost you once every share comes back.
 *
 * Reporting only — never the balance. The balance shows what left the account.
 *
 * Positive when more comes back than went out (Q82): a 10 Kč coffee repaid
 * with 11 Kč as a thank-you cost nothing and left a koruna over, and that is
 * what the figure says. It used to clamp at zero on the argument that such
 * shares were nonsense; a thank-you is not nonsense.
 */
export function netOf(txn: Txn): Minor {
	const shares = sharesOf(txn);
	if (shares.length === 0) return txn.amount;
	return minor(txn.amount + sum(shares.map((s) => abs(s.amount))));
}

// ── a share by percent ──────────────────────────────────────────────────────

/**
 * The shares the owed sheet offers in one tap — asked for 2026-09-29. Half
 * the dinner is the common case; a quarter and a tenth are the two slices
 * that come up next. Anything else is typed.
 */
export const SHARE_PRESETS = [10, 25, 50] as const;

/**
 * A typed percentage as hundredths of a percent: "50" → 5 000, "33,3" →
 * 3 330, "12,5 %" → 1 250. Integers, so the share is computed without a
 * float anywhere near the money.
 *
 * The shape of a percentage is the shape of an amount — digits, one comma,
 * at most two decimals — so `parseAmount` reads it, and the minor units it
 * returns are the hundredths. Null for anything that is not a slice of a
 * whole: empty, not a number, zero or less, over a hundred.
 */
export function parsePercent(input: string): number | null {
	const parsed = parseAmount(input.replace('%', ''));
	if (!parsed.ok || parsed.value <= 0 || parsed.value > 10_000) return null;
	return parsed.value;
}

/**
 * `hundredths` of a percent of `total`, rounded half away from zero to the
 * haléř — 50 % of 99,99 Kč is 50,00 Kč. A positive magnitude, whatever the
 * sign of the total: a share is always what comes back.
 */
export function shareByPercent(total: Minor, hundredths: number): Minor {
	return mulRatio(abs(total), hundredths, 10_000);
}
