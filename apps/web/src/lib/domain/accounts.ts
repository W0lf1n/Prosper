/**
 * Accounts, now that there is more than one — Q49.
 *
 * The rules this module holds are the ones the whole feature stands on:
 *
 * **An amount is an integer in its account's minor unit.** EUR cents on
 * Revolut, haléře at KB. `Minor` does not change; what changes is which
 * currency a given row's integers mean, and the answer is always its
 * account's.
 *
 * **Amounts in different currencies are never summed.** Anything that adds
 * rows together must first take them from accounts sharing a currency —
 * `groupByCurrency` / `inCurrency` are how — and a combined figure across
 * currencies does not exist in this app, because it would need an exchange
 * rate and no exchange rate is ever fetched or stored.
 *
 * **The home currency is the first account's.** Goals are measured in it
 * (their targets were typed in it), and only rows from home-currency accounts
 * count toward them. In practice it is CZK: the seed account is CZK and the
 * seed account is first.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { HOME_CURRENCY } from './money';
import type { Account, AccountKind, Txn } from './types';

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
	checking: 'běžný účet',
	savings: 'spořicí účet',
	cash: 'hotovost',
	credit: 'kreditní karta',
	loan: 'úvěr'
};

/** Alive and shown, in configured order. */
export function liveAccounts(accounts: readonly Account[]): Account[] {
	return accounts
		.filter((a) => !a.isDeleted && !a.isArchived)
		.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * The currency the person's financial life is denominated in: the first live
 * account's. Falls back to CZK when there is nothing yet — the seed account
 * is CZK, so in practice these are the same answer.
 */
export function homeCurrency(accounts: readonly Account[]): string {
	return liveAccounts(accounts)[0]?.currency ?? HOME_CURRENCY;
}

/**
 * The rows that may be summed with a figure in `currency`: those belonging to
 * accounts held in it. Archived accounts still count — their history is real —
 * so this filters by currency alone, not by `liveAccounts`.
 */
export function inCurrency(
	txns: readonly Txn[],
	accounts: readonly Account[],
	currency: string
): Txn[] {
	const ids = new Set(
		accounts.filter((a) => !a.isDeleted && a.currency === currency).map((a) => a.id)
	);
	return txns.filter((t) => ids.has(t.accountId));
}

/** Live accounts bucketed by currency, in first-appearance order. */
export function groupByCurrency(accounts: readonly Account[]): Map<string, Account[]> {
	const groups = new Map<string, Account[]>();
	for (const account of liveAccounts(accounts)) {
		const group = groups.get(account.currency);
		if (group) group.push(account);
		else groups.set(account.currency, [account]);
	}
	return groups;
}

// ── transfers ───────────────────────────────────────────────────────────────

export interface TransferDraft {
	from: Account;
	to: Account;
	/** What leaves `from`, positive, in `from`'s currency. */
	amountOut: number;
	/** What lands on `to`, positive, in `to`'s currency. */
	amountIn: number;
}

export type TransferProblem = 'same-account' | 'amount-out' | 'amount-in';

/**
 * What is still wrong with a transfer before it may be written.
 *
 * The two amounts are independent on purpose: between currencies the pair *is*
 * the exchange rate — 2 470 Kč out, 100 € in, rate implied and never stored —
 * and inside one currency the bank can still take a fee. The UI prefills them
 * equal in the same-currency case; equality is a default, not a rule.
 */
export function validateTransfer(draft: TransferDraft): TransferProblem[] {
	const problems: TransferProblem[] = [];
	if (draft.from.id === draft.to.id) problems.push('same-account');
	if (!(draft.amountOut > 0)) problems.push('amount-out');
	if (!(draft.amountIn > 0)) problems.push('amount-in');
	return problems;
}

/** A transfer row is not spending and not income — it is the same money on
    the move. Everything that measures a month asks this first. */
export function isTransfer(txn: Txn): boolean {
	return txn.transferPairId !== null;
}
