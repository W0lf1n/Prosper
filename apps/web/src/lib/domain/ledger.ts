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
import type { Txn } from './types';

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
 * Payees seen before, most recently used first. Feeds the entry autocomplete.
 */
export function recentPayees(txns: readonly Txn[], limit = 20): string[] {
	const seen = new Map<string, string>(); // lowercase → original casing
	const ordered = [...txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	for (const txn of ordered) {
		const name = txn.payee.trim();
		if (!name) continue;
		const key = name.toLocaleLowerCase('cs');
		if (!seen.has(key)) seen.set(key, name);
		if (seen.size >= limit) break;
	}
	return [...seen.values()];
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
