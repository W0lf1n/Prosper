/**
 * Trends — what a bucket costs this month against what it usually costs.
 *
 * `PROJECT-PLAN.md` P5 asks for "category trends month over month". The whole
 * module is a thin layer over `summariseMonth`, and that is deliberate: every
 * rule about what counts — a refund netting against its bucket rather than
 * counting as income, a one-off staying out of what a month costs — already
 * lives there, and re-deriving them here would be a second set of books with
 * the same name as the first.
 *
 * So this runs the existing summary once per month and lines the answers up.
 * Slower than a single pass, and the ledger is one person's; correctness is
 * worth more than the microseconds.
 *
 * **A comparison needs something to compare to.** A bucket with one month of
 * history gets no verdict at all rather than a confident-looking `+100 %`, for
 * the same reason a cap may not be set on a bucket that has never been
 * measured: a number you cannot check is worse than a blank.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { summariseMonth, type BucketTotal } from './checks';
import { shiftMonth, type IsoDate } from './datetime';
import { ZERO, minor, sub, sum, type Minor } from './money';
import type { Category, SpendType, Txn } from './types';

/** How many months back a trend looks, including the one being read. */
export const TREND_WINDOW = 6;

/** A bucket's outflow in one month. Positive magnitude — this is spending. */
export interface MonthPoint {
	month: string;
	amount: Minor;
}

export type Direction = 'up' | 'down' | 'flat';

export interface CategoryTrend {
	categoryId: string | null;
	name: string;
	spendType: SpendType | null;
	/** Oldest first, one entry per month in the window, zeroes included. */
	points: MonthPoint[];
	/** This month. */
	latest: Minor;
	/** The mean of the earlier months in the window. Null with nothing to average. */
	typical: Minor | null;
	/** `latest − typical`. Positive means dearer than usual. Null likewise. */
	change: Minor | null;
	changePercent: number | null;
	direction: Direction;
}

export interface TrendInput {
	month: string;
	txns: readonly Txn[];
	categories: readonly Category[];
	today: IsoDate;
	/** Months in the window, including `month`. Defaults to `TREND_WINDOW`. */
	window?: number;
}

/**
 * Below this, a move is noise rather than news.
 *
 * Ten per cent *and* fifty koruny: percentage alone makes a bucket that moved
 * from 40 to 80 Kč shout as loudly as one that moved from 4 000 to 8 000, and
 * an absolute floor alone lets a large bucket drift unremarked.
 */
const NOISE_PERCENT = 10;
const NOISE_AMOUNT = 5_000 as Minor; // 50 Kč

/** Outflow as a positive magnitude, one-offs excluded — what the month costs. */
function recurringSpend(bucket: BucketTotal): Minor {
	return minor(-(bucket.total - bucket.oneOffTotal));
}

function monthsBack(month: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => shiftMonth(month, i - (count - 1)));
}

/**
 * One row per expense bucket that appears anywhere in the window, ranked by how
 * far this month sits from its own normal — biggest overshoot first.
 *
 * Ranked by *distance from typical* rather than by size, because the largest
 * bucket is the rent every month and knowing that is worth nothing.
 */
export function categoryTrends(input: TrendInput): CategoryTrend[] {
	const { month, txns, categories, today } = input;
	const window = Math.max(1, input.window ?? TREND_WINDOW);

	/**
	 * A month before the ledger began is not a month you spent nothing in — it
	 * is a month that does not exist, and averaging it in as a zero makes every
	 * bucket in month two look like a catastrophe. (POTRAVINY read "+1594 %"
	 * against a "typical" of 381 Kč, which was one real month divided by five
	 * imaginary ones.)
	 *
	 * This is the same distinction the tape already makes between a gap day and
	 * an explicit zero, applied a level up. A genuine zero month *inside* the
	 * ledger still counts: spending nothing on JÍDLO in June is a fact.
	 */
	const begins = monthsCovered(txns)[0] ?? month;
	const months = monthsBack(month, window).filter((m) => m >= begins);

	const summaries = months.map((m) =>
		summariseMonth({ month: m, txns: [...txns], categories: [...categories], today })
	);

	// Every bucket that carried anything in any month of the window. A category
	// that has been dormant all window is not a trend, it is an empty row.
	const seen = new Map<string | null, { name: string; spendType: SpendType | null }>();
	for (const summary of summaries) {
		for (const bucket of summary.buckets) {
			if (bucket.category?.isIncome) continue;
			if (recurringSpend(bucket) === ZERO) continue;
			seen.set(bucket.category?.id ?? null, {
				name: bucket.category?.name ?? 'Bez kategorie',
				spendType: bucket.category?.spendType ?? null
			});
		}
	}

	const trends: CategoryTrend[] = [];
	for (const [categoryId, meta] of seen) {
		const points = summaries.map((summary, index) => {
			const bucket = summary.buckets.find((b) => (b.category?.id ?? null) === categoryId);
			return {
				month: months[index]!,
				amount: bucket ? recurringSpend(bucket) : ZERO
			};
		});

		const latest = points[points.length - 1]!.amount;
		const earlier = points.slice(0, -1);
		const typical =
			earlier.length > 0
				? minor(Math.round(sum(earlier.map((p) => p.amount)) / earlier.length))
				: null;

		const change = typical === null ? null : sub(latest, typical);
		const changePercent =
			typical === null || typical === ZERO
				? null
				: Math.round(((latest - typical) / typical) * 100);

		let direction: Direction = 'flat';
		if (change !== null && changePercent !== null) {
			const loud = Math.abs(change) >= NOISE_AMOUNT && Math.abs(changePercent) >= NOISE_PERCENT;
			if (loud) direction = change > 0 ? 'up' : 'down';
		}

		trends.push({
			categoryId,
			name: meta.name,
			spendType: meta.spendType,
			points,
			latest,
			typical,
			change,
			changePercent,
			direction
		});
	}

	return trends.sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
}

/** The month-by-month totals, oldest first — the export's summary sheet. */
export interface MonthRow {
	month: string;
	income: Minor;
	outflow: Minor;
	net: Minor;
	recurringOutflow: Minor;
	oneOffOutflow: Minor;
}

export function monthlyRows(input: {
	months: readonly string[];
	txns: readonly Txn[];
	categories: readonly Category[];
	today: IsoDate;
}): MonthRow[] {
	return input.months.map((month) => {
		const summary = summariseMonth({
			month,
			txns: [...input.txns],
			categories: [...input.categories],
			today: input.today
		});
		return {
			month,
			income: summary.income,
			outflow: summary.outflow,
			net: summary.net,
			recurringOutflow: summary.recurringOutflow,
			oneOffOutflow: summary.oneOffOutflow
		};
	});
}

/** Every month the ledger touches, oldest first. */
export function monthsCovered(txns: readonly Txn[]): string[] {
	const months = new Set<string>();
	for (const txn of txns) {
		if (txn.isDeleted) continue;
		months.add(txn.date.slice(0, 7));
	}
	return [...months].sort();
}
