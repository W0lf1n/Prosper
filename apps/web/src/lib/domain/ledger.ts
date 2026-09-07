/**
 * The tape.
 *
 * Turns a flat list of transactions into the structure the ledger screen draws:
 * months, days, running balance, and every day in between — including the ones
 * nothing happened on. Those are materialised rather than skipped, because a
 * day that cost nothing is an answer and the tape should say so.
 *
 * It used to say something else. A day with no rows and no explicit mark was a
 * *gap* — a hole in the book, drawn as one — and clearing it took a tap. That
 * distinction was retired on 2026-08-28: nothing recorded means nothing spent
 * (`DECISIONS.md` → "Every empty day is a no-spend day"), so an empty day
 * carries no flag at all and the screen reads it off `rows.length`.
 *
 * Pure. No Dexie, no fetch, no DOM (§11.6).
 */

import { ZERO, add, minor, sum, type Minor } from './money';
import { addDays, daysBetween, monthKey, today as todayIso, type IsoDate } from './datetime';
import { normalize } from './vocabulary';
import { groupByCurrency, pocketsOf } from './accounts';
import type { Account, AccountPocket, Txn } from './types';

export interface TapeTxn {
	txn: Txn;
	/** Account balance immediately after this transaction. */
	balance: Minor;
}

export interface TapeDay {
	date: IsoDate;
	rows: TapeTxn[];
	/** Net movement of the day. */
	net: Minor;
	/** Balance at the end of the day. */
	balance: Minor;
}

export interface TapeMonth {
	key: string; // YYYY-MM
	firstDate: IsoDate;
	days: TapeDay[];
	inflow: Minor;
	outflow: Minor; // negative
	net: Minor;
	/** Balance at the end of the month (i.e. of its most recent day). */
	balance: Minor;
}

export interface TapeOptions {
	openingBalance: Minor;
	/** Defaults to the real today. Injected so the tape is testable. */
	today?: IsoDate;
	/** Safety valve: never materialise more than this many empty days. */
	maxGapDays?: number;
}

/** Sort key inside a single day: creation order, ids are time-sortable. */
function byCreation(a: Txn, b: Txn): number {
	if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Build the tape, newest first.
 *
 * `txns` may arrive in any order and must already be filtered to one account
 * and to `isDeleted === false`.
 */
export function buildTape(txns: readonly Txn[], options: TapeOptions): TapeMonth[] {
	const { openingBalance, today = todayIso(), maxGapDays = 400 } = options;

	const ordered = [...txns].sort((a, b) =>
		a.date === b.date ? byCreation(a, b) : a.date < b.date ? -1 : 1
	);

	// Running balance forward from the opening balance.
	const balanceAfter = new Map<string, Minor>();
	let balance = openingBalance;
	for (const txn of ordered) {
		balance = add(balance, txn.amount);
		balanceAfter.set(txn.id, balance);
	}

	const byDate = new Map<IsoDate, Txn[]>();
	for (const txn of ordered) {
		const bucket = byDate.get(txn.date);
		if (bucket) bucket.push(txn);
		else byDate.set(txn.date, [txn]);
	}

	// The window we render: from the oldest recorded day (or today) up to today.
	const oldest = ordered[0]?.date ?? today;
	const newest = ordered.length > 0 ? maxDate(ordered[ordered.length - 1]!.date, today) : today;
	const span = daysBetween(oldest, newest);
	const from = span > maxGapDays ? addDays(newest, -maxGapDays) : oldest;

	const days: TapeDay[] = [];
	let cursor = newest;
	let runningEnd = ordered.length > 0 ? balance : openingBalance;

	while (cursor >= from) {
		const dayTxns = byDate.get(cursor) ?? [];
		const rows: TapeTxn[] = dayTxns.map((txn) => ({
			txn,
			balance: balanceAfter.get(txn.id) ?? openingBalance
		}));
		// Newest transaction of the day on top.
		rows.reverse();

		const net = sum(dayTxns.map((t) => t.amount));
		const endOfDay = runningEnd;

		days.push({ date: cursor, rows, net, balance: endOfDay });

		runningEnd = minor(endOfDay - net);
		cursor = addDays(cursor, -1);
	}

	return groupMonths(days);
}

function groupMonths(days: TapeDay[]): TapeMonth[] {
	const months: TapeMonth[] = [];
	let current: TapeMonth | null = null;

	for (const day of days) {
		const key = monthKey(day.date);
		if (!current || current.key !== key) {
			current = {
				key,
				firstDate: day.date,
				days: [],
				inflow: ZERO,
				outflow: ZERO,
				net: ZERO,
				balance: day.balance
			};
			months.push(current);
		}
		current.days.push(day);
		for (const row of day.rows) {
			if (row.txn.amount > 0) current.inflow = add(current.inflow, row.txn.amount);
			else current.outflow = add(current.outflow, row.txn.amount);
		}
		current.net = add(current.inflow, current.outflow);
	}

	return months;
}

function maxDate(a: IsoDate, b: IsoDate): IsoDate {
	return a > b ? a : b;
}

/** Current balance of an account: opening balance plus every live transaction. */
export function balanceOf(openingBalance: Minor, txns: readonly Txn[]): Minor {
	return add(openingBalance, sum(txns.map((t) => t.amount)));
}

/**
 * One line of what is on the accounts: an account's own money, or a pocket on
 * it (Q50). `pocket` is null on the account's own line.
 */
export interface BalanceLine {
	account: Account;
	pocket: AccountPocket | null;
	name: string;
	amount: Minor;
}

export interface CurrencyBalances {
	code: string;
	/** Every line in the group added together — each account's `openingTotal`
	    plus its rows. Exists per currency and nowhere above it, because there
	    is no figure across currencies (Q49). */
	total: Minor;
	/** The account's own line, then each of its pockets — and the same again
	    for a currency that, from before Q50, still holds a second account. */
	lines: BalanceLine[];
}

/**
 * Every live account's balance, grouped by currency, broken into the parts
 * the balance is made of, with each group's total.
 *
 * The one shape that answers "what is on the accounts". The CZK account with
 * 15 000 Kč at the bank and a Revolut pocket of 5 000 Kč is one koruna figure
 * of 20 000 Kč, and the screen may print both parts under it — which is the
 * whole reason the parts are returned rather than only the sum: a total that
 * does not show what it is made of is a number you have to trust rather than
 * read. `groupByCurrency` decides membership and order, so every screen that
 * sums per currency agrees on what is in the sum.
 *
 * **The account's own line carries every row.** A pocket is opening money
 * (Q50) — a named amount that joined the account from elsewhere — and nothing
 * spent afterwards is attributed back to the card it came from, so the pocket
 * line stays at the figure it was written with and the account's line moves.
 *
 * Soft-deleted rows are not rows; archived accounts are not shown, and their
 * rows belong to them alone, so they never leak into a live account's figure.
 */
export function balancesByCurrency(
	accounts: readonly Account[],
	txns: readonly Txn[]
): CurrencyBalances[] {
	const movement = new Map<string, Minor>();
	for (const txn of txns) {
		if (txn.isDeleted) continue;
		movement.set(txn.accountId, add(movement.get(txn.accountId) ?? ZERO, txn.amount));
	}

	return [...groupByCurrency(accounts)].map(([code, group]) => {
		const lines: BalanceLine[] = [];
		for (const account of group) {
			lines.push({
				account,
				pocket: null,
				name: account.name,
				amount: add(account.openingBalance, movement.get(account.id) ?? ZERO)
			});
			for (const pocket of pocketsOf(account)) {
				lines.push({ account, pocket, name: pocket.name, amount: pocket.amount });
			}
		}
		return { code, total: sum(lines.map((line) => line.amount)), lines };
	});
}

/**
 * Payees seen before, most recently used first. Feeds the entry autocomplete.
 */
export function recentPayees(txns: readonly Txn[], limit = 20): string[] {
	const seen = new Map<string, string>(); // lowercase → original casing
	const ordered = [...txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	for (const txn of ordered) {
		// A transfer's payee is machine-written; offering it back as an
		// autocomplete for expenses would only pollute the list (Q49).
		if (txn.transferPairId !== null) continue;
		const name = txn.payee.trim();
		if (!name) continue;
		const key = name.toLocaleLowerCase('cs');
		if (!seen.has(key)) seen.set(key, name);
		if (seen.size >= limit) break;
	}
	return [...seen.values()];
}

/** Fewer characters than this is not yet a question, and the list stays shut. */
export const MIN_PAYEE_QUERY = 3;

/**
 * Payees from the ledger's own history that match what is being typed.
 *
 * A search, not a shortlist: the whole history is the pool, so "kaf" finds
 * "ranní kafe" from March even if thirty other things were bought since.
 * The match is on the start of any word, with case and diacritics folded —
 * "alb" finds "Albert", "kav" finds "Káva u Petra". Most recent first, the
 * casing it was last typed in, and nothing at all until the query reaches
 * `MIN_PAYEE_QUERY` characters, because a list that opens on an empty field
 * is noise in front of the one thing the field is for.
 *
 * Transfer legs are machine-written and never offered (Q49). An empty ledger
 * yields an empty list — there is no seed vocabulary of payees anywhere.
 */
export function suggestPayees(txns: readonly Txn[], query: string, limit = 8): string[] {
	const needle = normalize(query);
	if (needle.length < MIN_PAYEE_QUERY) return [];

	const seen = new Map<string, string>();
	const ordered = [...txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	for (const txn of ordered) {
		if (txn.transferPairId !== null) continue;
		const name = txn.payee.trim();
		if (!name) continue;
		const key = name.toLocaleLowerCase('cs');
		if (seen.has(key)) continue;
		if (!wordStartsWith(normalize(name), needle)) continue;
		seen.set(key, name);
		if (seen.size >= limit) break;
	}
	return [...seen.values()];
}

/** Does any word of `text` begin with `prefix`? Words are runs of letters and
    digits; "u-petra" is two of them. */
function wordStartsWith(text: string, prefix: string): boolean {
	if (text.startsWith(prefix)) return true;
	let at = text.indexOf(prefix, 1);
	while (at !== -1) {
		if (!/[a-z0-9]/.test(text[at - 1]!)) return true;
		at = text.indexOf(prefix, at + 1);
	}
	return false;
}

/**
 * Category ids ranked by how often they get used, most-used first, ties broken
 * by whichever was used most recently, then by configured order.
 *
 * The entry screen only shows the top few, so this decides what is one tap away
 * and what is behind a search box. Frequency beats recency here: one unusual
 * purchase should not push the everyday bucket off the row.
 */
export function categoryRanking(txns: readonly Txn[], allIds: readonly string[]): string[] {
	const uses = new Map<string, number>();
	const lastUsed = new Map<string, string>();

	for (const txn of txns) {
		if (!txn.categoryId || txn.isDeleted) continue;
		if (!allIds.includes(txn.categoryId)) continue;
		uses.set(txn.categoryId, (uses.get(txn.categoryId) ?? 0) + 1);
		const seen = lastUsed.get(txn.categoryId);
		if (!seen || txn.createdAt > seen) lastUsed.set(txn.categoryId, txn.createdAt);
	}

	return [...allIds].sort((a, b) => {
		const byUse = (uses.get(b) ?? 0) - (uses.get(a) ?? 0);
		if (byUse !== 0) return byUse;
		const recentA = lastUsed.get(a) ?? '';
		const recentB = lastUsed.get(b) ?? '';
		if (recentA !== recentB) return recentA < recentB ? 1 : -1;
		return allIds.indexOf(a) - allIds.indexOf(b);
	});
}

/**
 * Category ids in the order the entry screen should offer them: most recently
 * used first, then the rest in their configured order. Speed of entry depends
 * on the right chip being the first chip.
 */
export function categoryOrder(txns: readonly Txn[], allIds: readonly string[]): string[] {
	const recent: string[] = [];
	const ordered = [...txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	for (const txn of ordered) {
		if (!txn.categoryId) continue;
		if (recent.includes(txn.categoryId)) continue;
		if (!allIds.includes(txn.categoryId)) continue;
		recent.push(txn.categoryId);
		if (recent.length >= 8) break;
	}
	return [...recent, ...allIds.filter((id) => !recent.includes(id))];
}
