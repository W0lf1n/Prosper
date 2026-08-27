/**
 * Draining OSTATNÍ — `TRIMMING-AND-TRAINING.md` T4.
 *
 * `other-overflow` has been able to *say* that the dumping ground is too big
 * since P1, and could do nothing about it. The workbook is what makes that
 * unacceptable: **100 895 Kč went through OSTATNÍ in eight months**, the second
 * largest bucket after housing, explaining nothing. A finding that cannot be
 * acted on is a finding that gets scrolled past, and then the number it reports
 * stops being read at all.
 *
 * So this turns the finding into a list of rows with somewhere to put them. The
 * suggestion comes from the same hand-written vocabulary the entry screen uses
 * (`suggestBucket`), which means a row the app would have caught at entry time
 * is caught here too — just later, and in bulk.
 *
 * **A row with no suggestion is still listed.** The vocabulary only knows
 * Petr's own words; the rows it cannot place are exactly the ones most likely
 * to be miscellaneous junk, and hiding them would leave the bucket looking
 * drained when it is not.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { monthKey } from './datetime';
import { abs, type Minor } from './money';
import type { Category, Txn } from './types';
import { normalize, suggestBucket } from './vocabulary';

export interface RefileCandidate {
	txn: Txn;
	/** Where the vocabulary would put it, or null when it has no opinion. */
	suggestion: Category | null;
}

export interface RefileInput {
	/** Every live transaction of the account. */
	txns: readonly Txn[];
	categories: readonly Category[];
	month: string; // YYYY-MM
	/** The bucket being drained. Usually OSTATNÍ, but nothing here assumes it. */
	categoryId: string;
}

/**
 * The month's rows in one bucket, **largest first**, each with a suggestion.
 *
 * Largest first rather than newest first: the point of the exercise is to make
 * the bucket smaller, and a 6 291 Kč "objednávka" is worth more than nine
 * coffees. Newest-first would put the trivial rows at the top of a list nobody
 * scrolls to the bottom of.
 */
export function refileCandidates(input: RefileInput): RefileCandidate[] {
	const { txns, categories, month, categoryId } = input;

	const live = categories.filter((c) => !c.isDeleted && !c.isArchived);

	const rows = txns.filter(
		(txn) =>
			!txn.isDeleted &&
			txn.categoryId === categoryId &&
			monthKey(txn.date) === month &&
			// Outflow only. An inflow filed here is a refund, and §6.1 already has
			// a rule for those — moving it would change what that rule sees.
			txn.amount < 0
	);

	return rows
		.map((txn) => {
			const guess = suggestBucket(txn.payee);
			const target = guess
				? (live.find((c) => normalize(c.name) === guess && c.id !== categoryId) ?? null)
				: null;
			return { txn, suggestion: target };
		})
		.sort((a, b) => abs(b.txn.amount) - abs(a.txn.amount));
}

export interface DrainSummary {
	/** Rows still in the bucket this month. */
	remaining: number;
	/** What they add up to. Positive magnitude. */
	total: Minor;
	/** How many the vocabulary can place without being asked. */
	suggested: number;
}

export function summariseDrain(candidates: readonly RefileCandidate[]): DrainSummary {
	return {
		remaining: candidates.length,
		total: candidates.reduce((sum, c) => sum + abs(c.txn.amount), 0) as Minor,
		suggested: candidates.filter((c) => c.suggestion !== null).length
	};
}

/** The bucket a drain targets, by name. Null when this ledger has no such bucket. */
export function dumpingGround(categories: readonly Category[]): Category | null {
	return (
		categories.find((c) => !c.isDeleted && !c.isArchived && normalize(c.name) === 'ostatni') ?? null
	);
}

/** Buckets a row may be moved into — anything live that is not where it already is. */
export function refileTargets(
	categories: readonly Category[],
	fromCategoryId: string,
	options: { income?: boolean } = {}
): Category[] {
	return categories.filter(
		(c) =>
			!c.isDeleted &&
			!c.isArchived &&
			c.id !== fromCategoryId &&
			(options.income === true || !c.isIncome)
	);
}
