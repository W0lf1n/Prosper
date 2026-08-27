/**
 * Coverage and the streak — the Tracking law reporting on itself.
 *
 * `TRIMMING-AND-TRAINING.md` R1. The evidence is the strongest in the project:
 * the spreadsheet had **no dates at all**, so coverage was not merely low, it
 * was unmeasurable. This is the number that says whether the ledger can be
 * believed.
 *
 * Two rules do all the work here, and both are decisions rather than details:
 *
 * **Covered means a transaction *or* an explicit `DayMark`.** That is the whole
 * reason `DayMark` exists — a day you spent nothing on is a real answer, and a
 * day you never opened the app is a hole. Counting only transactions would
 * punish a frugal week.
 *
 * **Measured against days *elapsed*, never days in the month.** Otherwise the
 * 3rd of the month reads as a 90 % failure, which is both wrong and the kind of
 * thing that makes somebody stop looking.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { addDays, daysBetween, endOfMonth, monthKey, type IsoDate } from './datetime';
import type { DayMark, Txn } from './types';

export interface CoverageInput {
	month: string; // YYYY-MM
	txns: readonly Txn[];
	marks: readonly DayMark[];
	today: IsoDate;
}

export interface Coverage {
	month: string;
	/** Days with a transaction or an explicit mark. */
	covered: number;
	/** Days of the month that have happened. Never days *in* the month. */
	elapsed: number;
	/** 0–100. Zero elapsed days reads as 100: nothing has been missed yet. */
	percent: number;
	/** The holes, oldest first. Days nobody recorded and nobody marked. */
	gaps: IsoDate[];
}

/** Every date this month that carries a transaction or a mark. */
function coveredDays(input: CoverageInput): Set<IsoDate> {
	const days = new Set<IsoDate>();
	for (const txn of input.txns) {
		if (txn.isDeleted) continue;
		if (monthKey(txn.date) === input.month) days.add(txn.date);
	}
	for (const mark of input.marks) {
		if (monthKey(mark.date) === input.month) days.add(mark.date);
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

	const days = coveredDays(input);

	const gaps: IsoDate[] = [];
	for (let day = 1; day <= elapsed; day += 1) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		if (!days.has(date)) gaps.push(date);
	}

	const covered = elapsed - gaps.length;

	return {
		month,
		covered,
		elapsed,
		percent: elapsed === 0 ? 100 : Math.round((covered / elapsed) * 100),
		gaps
	};
}

export interface StreakInput {
	txns: readonly Txn[];
	marks: readonly DayMark[];
	today: IsoDate;
	/** How far back to walk before giving up. A year is more than enough. */
	maxDays?: number;
}

export interface Streak {
	days: number;
	/** True when today itself is covered — the streak is safe rather than at risk. */
	includesToday: boolean;
}

const MAX_STREAK_WALK = 400;

/**
 * Consecutive covered days, ending today **or yesterday**.
 *
 * Yesterday is included deliberately. A streak that dies at midnight punishes
 * the person who records at breakfast, and a streak you can lose in your sleep
 * is a streak you stop caring about. Until today is covered the count still
 * stands — `includesToday` is how the screen says it is at risk rather than
 * broken.
 */
export function currentStreak(input: StreakInput): Streak {
	const { today } = input;
	const limit = input.maxDays ?? MAX_STREAK_WALK;

	const days = new Set<IsoDate>();
	for (const txn of input.txns) {
		if (!txn.isDeleted) days.add(txn.date);
	}
	for (const mark of input.marks) days.add(mark.date);

	const includesToday = days.has(today);
	let cursor = includesToday ? today : addDays(today, -1);
	if (!days.has(cursor)) return { days: 0, includesToday: false };

	let count = 0;
	while (count < limit && days.has(cursor)) {
		count += 1;
		cursor = addDays(cursor, -1);
	}

	return { days: count, includesToday };
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
