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
 * **A month is measured in a currency, money sits on an account** (Q83).
 * Since 2026-10-05 a currency may hold several accounts — the card and the
 * cash in the wallet — so the screens that answer "how did the month go"
 * read every account in the currency, and the screens that answer "what is
 * on it" read one account.
 *
 * **The home currency is the first account's.** Goals are measured in it
 * (their targets were typed in it), and only rows from home-currency accounts
 * count toward them. In practice it is CZK: the seed account is CZK and the
 * seed account is first.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { HOME_CURRENCY, add, sum, type Minor } from './money';
import type { Account, AccountKind, AccountPocket, Txn } from './types';
import { normalize } from './vocabulary';

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

/**
 * Does another live account hold this one's currency? Then the currency no
 * longer tells them apart — "Kč" and "Kč" — and a screen has to say which
 * by something else: the kind, the name.
 */
export function sharesCurrency(account: Account, accounts: readonly Account[]): boolean {
	return liveAccounts(accounts).some((a) => a.id !== account.id && a.currency === account.currency);
}

/**
 * The kind a name most likely means — "Hotovost" and "peněženka" are cash,
 * anything else is an account at a bank. A default for a form, never a rule:
 * the select beside it says what the account is.
 */
export function guessAccountKind(name: string): AccountKind {
	const folded = normalize(name);
	return /hotovost|penezenk|cash|kapsa/.test(folded) ? 'cash' : 'checking';
}

// ── pockets (Q50) ───────────────────────────────────────────────────────────

//
// Q50 made it one account per currency, and koruny that sat somewhere else
// joined the CZK account as a pocket: a named amount that opened it. Q83
// lifted the rule on 2026-10-05 — a second koruna account is an account
// again — so a pocket is now the lighter of two ways to say "some of it is
// elsewhere": no rows of its own, no balance that moves. The pockets that
// exist keep counting; Settings offers to turn one into an account.

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
// A transfer is two rows, one per account, linked by `transferPairId` (§6.1)
// and deleted and restored together. What the legs *mean* depends on whether
// the money changed currency, and the bucket on them says which:
//
// **A move** — no bucket on either leg. Cash out of the ATM, the card topped
// up from the account: the money is still yours and still koruny, so neither
// leg is spent or earned and no measurement sees it (Q83). Only the two
// balances move. This is Q49's original rule, back for the case it was
// written for now that two accounts may share a currency again.
//
// **An exchange** — a bucket on both. Since 2026-09-02 the outgoing leg is an
// expense from a bucket the person chose and the incoming leg is income in
// SMĚNA, because the koruna month should show the holiday it paid for and
// the euro month should show what arrived. Every transfer across currencies
// is one. A transfer inside a currency may be one too, when it pays for
// something: koruny moved to the savings account, filed under SPOŘENÍ, are
// the month's saving.

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
	/** The bucket the outgoing leg is spent from — null for a move. */
	categoryId: string | null;
}

export type TransferProblem = 'same-account' | 'amount-out' | 'amount-in' | 'category';

/**
 * What is still wrong with a transfer before it may be written.
 *
 * The two amounts are independent on purpose: between currencies the pair *is*
 * the exchange rate — 2 470 Kč out, 100 € in — and no rate is ever stored.
 * Inside one currency the sheet asks once and the two are equal.
 *
 * A bucket is required across currencies, for the reason every row's bucket
 * is: koruny that became euros were spent on something, and an
 * uncategorised expense is a hole in next month's report. Inside a currency
 * it is optional — leaving it out is what makes the transfer a move.
 */
export function validateTransfer(draft: TransferDraft): TransferProblem[] {
	const problems: TransferProblem[] = [];
	if (draft.from.id === draft.to.id) problems.push('same-account');
	if (!(draft.amountOut > 0)) problems.push('amount-out');
	if (!(draft.amountIn > 0)) problems.push('amount-in');
	if (draft.from.currency !== draft.to.currency && !draft.categoryId) problems.push('category');
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
 * A transfer leg — one half of a move or an exchange. What still asks this
 * is what a leg is *not*: a payee worth suggesting, or a subscription worth
 * watching for.
 */
export function isTransfer(txn: Txn): boolean {
	return txn.transferPairId !== null;
}

/**
 * A transfer leg with no bucket: money that only moved between your own
 * accounts (Q83). Neither spent nor earned, so every measurement — the
 * month, the split, the trends, the days without an expense, the
 * uncategorised queue — leaves it out, and only the balances see it.
 *
 * Legs written between Q49 and 2026-09-02 carry no bucket either. They were
 * moves when they were written, and they read as moves again.
 */
export function isMove(txn: Txn): boolean {
	return txn.transferPairId !== null && txn.categoryId === null;
}
