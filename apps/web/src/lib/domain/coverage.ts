/**
 * No-spend days, and the run of them.
 *
 * **This module was rewritten on 2026-08-28, and the rewrite reverses a
 * decision.** It used to answer "how many days did you record", counting a day
 * as covered when it carried a transaction *or* an explicit `DayMark`, and
 * calling everything else a hole. That question is gone: a day with no expense
 * on it *is* a day without an expense, and the app no longer asks anybody to
 * confirm that by tapping. See `DECISIONS.md` → "Every empty day is a no-spend
 * day".
 *
 * So what is left is the number that survived the change, and it is a Trimming
 * figure rather than a Tracking one: **how many days this month cost nothing.**
 * It is honest — it comes off the ledger with no second signal to maintain —
 * and it is the one a frugal week should be proud of.
 *
 * Two rules do the work, and both are the same ones as before:
 *
 * **An expense is an outflow.** A day that only saw money arrive still cost
 * nothing, and reads as quiet.
 *
 * **Measured against days *elapsed*, never days in the month.** Otherwise the
 * 3rd of the month is a verdict on 28 days that have not happened.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { addDays, daysBetween, endOfMonth, monthKey, type IsoDate } from './datetime';
import type { Txn } from './types';

export interface CoverageInput {
	month: string; // YYYY-MM
	txns: readonly Txn[];
	today: IsoDate;
}

export interface Coverage {
	month: string;
	/** Days of the month that have happened. Never days *in* the month. */
	elapsed: number;
	/** Elapsed days that carry at least one expense. */
	spending: number;
	/** Elapsed days with no expense on them at all. */
	quiet: number;
	/** 0–100, the share of elapsed days that cost nothing. */
	percent: number;
	/** Those quiet days, oldest first. */
	quietDays: IsoDate[];
}

/** Every date that carries an outflow. Income does not make a day expensive,
    and neither does a transfer (Q49) — moving money is not spending it. */
function spendingDays(txns: readonly Txn[]): Set<IsoDate> {
	const days = new Set<IsoDate>();
	for (const txn of txns) {
		if (txn.isDeleted || txn.transferPairId !== null) continue;
		if (txn.amount < 0) days.add(txn.date);
	}
	return days;
}

export function monthCoverage(input: CoverageInput): Coverage {
	const { month, today } = input;

	// A month in the past is complete; the current one has only got as far as
	// today; a month in the future has not started.
	const current = monthKey(today);
	const lastDay = month < current ? endOfMonth(month) : month === current ? today : `${month}-01`;
	const elapsed = month > current ? 0 : Number(lastDay.slice(8, 10));

	const spent = spendingDays(input.txns);

	const quietDays: IsoDate[] = [];
	for (let day = 1; day <= elapsed; day += 1) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		if (!spent.has(date)) quietDays.push(date);
	}

	const quiet = quietDays.length;

	return {
		month,
		elapsed,
		spending: elapsed - quiet,
		quiet,
		percent: elapsed === 0 ? 0 : Math.round((quiet / elapsed) * 100),
		quietDays
	};
}

export interface StreakInput {
	txns: readonly Txn[];
	today: IsoDate;
	/** How far back to walk before giving up. A year is more than enough. */
	maxDays?: number;
}

export interface Streak {
	days: number;
}

const MAX_STREAK_WALK = 400;

/**
 * Consecutive days without an expense, ending **yesterday**.
 *
 * Today is a condition rather than a term: spend anything today and the run is
 * zero, but a today that is still quiet at ten in the morning does not get
 * counted — the day is not over, and a streak that claims a day before it has
 * been lived is the kind of flattery that makes a number worthless.
 *
 * It never reaches back past the first row in the ledger. The years before the
 * app existed were not a frugal streak.
 */
export function quietStreak(input: StreakInput): Streak {
	const { today } = input;
	const limit = input.maxDays ?? MAX_STREAK_WALK;

	let earliest: IsoDate | null = null;
	for (const txn of input.txns) {
		if (txn.isDeleted) continue;
		if (earliest === null || txn.date < earliest) earliest = txn.date;
	}
	if (earliest === null) return { days: 0 };

	const spent = spendingDays(input.txns);
	if (spent.has(today)) return { days: 0 };

	let count = 0;
	let cursor = addDays(today, -1);
	while (count < limit && cursor >= earliest && !spent.has(cursor)) {
		count += 1;
		cursor = addDays(cursor, -1);
	}

	return { days: count };
}

/**
 * How long since the ledger last heard anything at all.
 *
 * Null when it never has. Used for the empty state — "nothing yet" and "nothing
 * for eleven days" are different problems and should not read the same.
 */
export function daysSinceLastEntry(txns: readonly Txn[], today: IsoDate): number | null {
	let latest: IsoDate | null = null;
	for (const txn of txns) {
		if (txn.isDeleted) continue;
		if (txn.date > today) continue;
		if (latest === null || txn.date > latest) latest = txn.date;
	}
	return latest === null ? null : daysBetween(latest, today);
}
