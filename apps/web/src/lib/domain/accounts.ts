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

import { CURRENCIES, HOME_CURRENCY, add, sum, type Minor } from './money';
import type { Account, AccountKind, AccountPocket, Txn } from './types';

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

// ── one account per currency (Q50) ──────────────────────────────────────────

/**
 * The currencies a new account may still be opened in: every offered code
 * that no live account already holds. An archived account frees its
 * currency — changing banks is exactly the case that needs it.
 *
 * The rule itself: **one account per currency.** "Which CZK account" was a
 * question with no useful answer — the expense is the expense wherever the
 * card was — so the app stops asking it. Koruny that sit somewhere else
 * join the CZK account as a pocket (`pocketsOf`) instead of becoming a
 * second account nobody wants to choose between.
 */
export function availableCurrencies(
	accounts: readonly Account[],
	offered: readonly string[] = CURRENCIES
): string[] {
	const taken = new Set(liveAccounts(accounts).map((a) => a.currency));
	return offered.filter((code) => !taken.has(code));
}

/** The pockets on an account — empty for a row an older build wrote. */
export function pocketsOf(account: Account): AccountPocket[] {
	return Array.isArray(account.pockets) ? account.pockets : [];
}

/** Money the account opened with: the stated opening balance plus everything
    that joined it from elsewhere. Every balance in the app starts here. */
export function openingTotal(account: Account): Minor {
	return add(account.openingBalance, sum(pocketsOf(account).map((p) => p.amount)));
}

export type PocketProblem = 'name' | 'amount';

/** What is still wrong with a pocket before it may be written: it needs a
    name, because "5 000 Kč from somewhere" is the note that cannot be read
    back, and a positive amount. */
export function validatePocket(draft: { name: string; amount: number }): PocketProblem[] {
	const problems: PocketProblem[] = [];
	if (!draft.name.trim()) problems.push('name');
	if (!(draft.amount > 0)) problems.push('amount');
	return problems;
}

// ── transfers ───────────────────────────────────────────────────────────────

//
// With one account per currency (Q50) every transfer crosses a currency, so a
// transfer *is* an exchange: koruny leave the CZK account and euros land on
// the EUR one. Since 2026-09-02 the two legs count the way they read — the
// outgoing leg is an expense from a bucket the person chose, the incoming
// leg is income in SMĚNA — because the koruna month should show the holiday
// it paid for, and the euro month should show what arrived. Q49's rule that
// a transfer is neither was written for same-currency moves, which no longer
// exist. The two legs stay one fact: linked, deleted together, restored
// together, and the pair of amounts is still the only rate the app knows.

/**
 * The income bucket every incoming leg lands in — one constant id, so two
 * paired devices that each write their first exchange before syncing create
 * the *same* row and the merge collapses them. Not PŘÍJEM: an exchange is not
 * earnings, and a conversion back to koruny must not read as a raise.
 */
export const EXCHANGE_CATEGORY_ID = '00000000-0000-7000-8000-00000000c2e0';
export const EXCHANGE_CATEGORY_NAME = 'SMĚNA';

export interface TransferDraft {
	from: Account;
	to: Account;
	/** What leaves `from`, positive, in `from`'s currency. */
	amountOut: number;
	/** What lands on `to`, positive, in `to`'s currency. */
	amountIn: number;
	/** The bucket the outgoing leg is spent from. */
	categoryId: string | null;
}

export type TransferProblem = 'same-account' | 'amount-out' | 'amount-in' | 'category';

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
	/* Required for the reason every row's bucket is: an uncategorised expense
	   is a hole in next month's report. */
	if (!draft.categoryId) problems.push('category');
	return problems;
}

/**
 * The bucket the last exchange was spent from, so the sheet can open on it.
 * Most exchanges are the same exchange — koruny into the holiday wallet — and
 * a default that remembers costs no storage: it is read off the legs.
 */
export function lastExchangeCategoryId(txns: readonly Txn[]): string | null {
	let latest: Txn | null = null;
	for (const txn of txns) {
		if (txn.isDeleted || !isTransfer(txn) || txn.amount >= 0 || !txn.categoryId) continue;
		if (!latest || txn.createdAt > latest.createdAt) latest = txn;
	}
	return latest?.categoryId ?? null;
}

/**
 * A transfer leg — one half of an exchange. Since 2026-09-02 it counts in
 * the month like any other row; what still asks this is what a leg is *not*:
 * a payee worth suggesting, or a subscription worth watching for.
 */
export function isTransfer(txn: Txn): boolean {
	return txn.transferPairId !== null;
}
