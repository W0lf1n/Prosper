/**
 * The 10 / 10 / 10 / 70 split.
 *
 * The book's claim is not "spend less". It is that **income has a shape**, and
 * the shape is decided before the month starts rather than discovered after it:
 *
 *   10 %  given away, nothing expected back
 *   10 %  put aside — savings, investment, the future
 *   10 %  debt down, or the reserve if there is no debt
 *   70 %  everything it costs to live
 *
 * Two things about how this is measured, both deliberate:
 *
 * **Shares are of income, not of outflow.** A share of outflow always sums to
 * 100 % and therefore says nothing about whether you spent more than came in.
 * Against income, the four classes plus what is left over are the whole picture,
 * and overspending shows up as the thing it is.
 *
 * **It reads the month summary, not the transactions.** `summariseMonth` has
 * already resolved refunds against their bucket and separated real income from
 * money handed back (§6.1). Recomputing from raw rows here would mean
 * reimplementing those rules and eventually disagreeing with them.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { ZERO, abs, minor, mulRatio, percentOf, roundToUnit, sub, sum, type Minor } from './money';
import type { BucketTotal } from './checks';
import type { SpendType } from './types';

export type ProsperityClass = 'give' | 'save' | 'debt' | 'live';

/** The order they are drawn and listed in: the three decisions, then the rest. */
export const PROSPERITY_CLASSES: readonly ProsperityClass[] = ['give', 'save', 'debt', 'live'];

export const TARGET_SHARE: Record<ProsperityClass, number> = {
	give: 10,
	save: 10,
	debt: 10,
	live: 70
};

/** A bucket's type, as the badge on its row and the segment in its editor say it. */
export const SPEND_TYPE_LABEL: Record<SpendType, string> = {
	need: 'nutné',
	want: 'chtěné',
	give: 'dávání',
	save: 'spoření',
	debt: 'dluh'
};

export const CLASS_LABEL: Record<ProsperityClass, string> = {
	give: 'Dávání',
	save: 'Spoření',
	debt: 'Dluh a rezerva',
	live: 'Život'
};

/** What each class is *for*, in one line — the legend's second row. */
export const CLASS_NOTE: Record<ProsperityClass, string> = {
	give: 'bez očekávání návratu',
	save: 'stranou, na později',
	debt: 'splátky, nebo rezerva',
	live: 'nutné i chtěné dohromady'
};

/**
 * `need` and `want` are both "what it costs to live".
 *
 * They stay separate everywhere else, because the need/want line is what the
 * Trimming law acts on. Here they are one number, because the book's 70 % is
 * one number.
 */
export function classOf(spendType: SpendType): ProsperityClass {
	switch (spendType) {
		case 'give':
			return 'give';
		case 'save':
			return 'save';
		case 'debt':
			return 'debt';
		default:
			return 'live';
	}
}

export interface ClassSlice {
	cls: ProsperityClass;
	label: string;
	/** Positive magnitude that went into this class. */
	amount: Minor;
	/** Share of income, rounded. Zero when there was no income. */
	percent: number;
	target: number;
	/** `percent - target`. Negative = under the mark. */
	delta: number;
}

export interface ProsperitySplit {
	income: Minor;
	/** Without income the shares are undefined, and the app says so rather than dividing by zero. */
	hasIncome: boolean;
	slices: ClassSlice[];
	/** Income minus everything allocated. Negative means the month spent more than it earned. */
	left: Minor;
	/** Share of income still unspent. Negative when overspent. */
	leftPercent: number;
	/** The class furthest below its target — the one thing to fix. Null when nothing is short. */
	weakest: ClassSlice | null;
}

export interface SplitInput {
	income: Minor;
	/** From `summariseMonth`. Totals are signed; spending is negative. */
	buckets: readonly BucketTotal[];
}

export function prosperitySplit(input: SplitInput): ProsperitySplit {
	const { income } = input;
	const hasIncome = income > 0;

	const totals = new Map<ProsperityClass, number>(PROSPERITY_CLASSES.map((c) => [c, 0]));
	for (const bucket of input.buckets) {
		// An uncategorised row is money that left and nobody said why: it is part
		// of what living cost, because it certainly was not given away or saved.
		const cls = bucket.category ? classOf(bucket.category.spendType) : 'live';
		totals.set(cls, (totals.get(cls) ?? 0) + Math.abs(bucket.total));
	}

	const slices: ClassSlice[] = PROSPERITY_CLASSES.map((cls) => {
		const amount = minor(totals.get(cls) ?? 0);
		const percent = hasIncome ? percentOf(amount, income) : 0;
		return {
			cls,
			label: CLASS_LABEL[cls],
			amount,
			percent,
			target: TARGET_SHARE[cls],
			delta: hasIncome ? percent - TARGET_SHARE[cls] : 0
		};
	});

	const allocated = sum(slices.map((s) => s.amount));
	const left = minor(income - allocated);
	const leftPercent = hasIncome ? Math.round((left / income) * 100) : 0;

	// "Weakest" is only meaningful against income. The three deliberate classes
	// are the ones you can be short on; being under 70 % on living is not a
	// failure, it is the point.
	const shortfalls = hasIncome
		? slices.filter((s) => s.cls !== 'live' && s.delta < 0).sort((a, b) => a.delta - b.delta)
		: [];

	return { income, hasIncome, slices, left, leftPercent, weakest: shortfalls[0] ?? null };
}

/** The target split, as slices — what the second chart draws. Same shape, no data. */
export function targetSlices(): { cls: ProsperityClass; label: string; percent: number }[] {
	return PROSPERITY_CLASSES.map((cls) => ({
		cls,
		label: CLASS_LABEL[cls],
		percent: TARGET_SHARE[cls]
	}));
}

/**
 * A share of the income, in whole units of currency — what the book would
 * put on one class from a stated income (Q67, Q69). Whole units because a
 * standing order is not set in haléře. Zero without an income.
 */
export function shareAmount(income: Minor, share: number): Minor {
	if (!Number.isInteger(share) || share < 0 || share > 100) {
		throw new RangeError(`shareAmount: not a whole percent: ${share}`);
	}
	if (income <= 0) return ZERO;
	return roundToUnit(mulRatio(income, share, 100));
}

/** One line of Czech naming the single thing most worth fixing. */
export function verdict(split: ProsperitySplit): string {
	if (!split.hasIncome) return 'Bez příjmu v tomhle měsíci se podíly nedají spočítat.';
	if (split.left < ZERO) return `Utraceno o ${-split.leftPercent} % víc, než přišlo.`;
	if (!split.weakest) return 'Všechny tři podíly sedí. Zbytek je na život.';
	const { label, percent, target } = split.weakest;
	return `${label}: ${percent} % místo ${target} %. Tohle je ta jedna věc.`;
}

// ── the split as four meters ───────────────────────────────────────────────

/**
 * Where one class stands against the book, in money rather than in points.
 *
 * - `met` — giving, saving or debt reached its share of the income.
 * - `short` — it has not yet; `gap` is what is missing.
 * - `within` — living cost less than its 70 %; `gap` is the room left.
 * - `over` — living cost more; `gap` is by how much.
 */
export type BarState = 'met' | 'short' | 'within' | 'over';

export interface SplitBar {
	cls: ProsperityClass;
	label: string;
	note: string;
	/** Positive magnitude that went into the class. */
	amount: Minor;
	/** The book's share of this month's income, in whole units. */
	mark: Minor;
	percent: number;
	target: number;
	state: BarState;
	/** Positive magnitude between `amount` and `mark`. */
	gap: Minor;
	/** How full the meter is, 0–100 — `amount` against `mark`. */
	fill: number;
}

/**
 * The split as four meters, each against its own mark (2026-10-18).
 *
 * The ring on Přehled answers "what shape was the month" and nobody could
 * read it: four colours, a percentage in the hole and a column of signed
 * deltas is three encodings for one question. A meter answers "how far am I
 * from the book" — the question the law asks — in the one shape every screen
 * in the app already uses for "how far along", with the koruny it would take.
 */
export function splitBars(split: ProsperitySplit): SplitBar[] {
	return split.slices.map((slice) => {
		const mark = shareAmount(split.income, slice.target);
		const reached = slice.amount >= mark;
		const state: BarState =
			slice.cls === 'live'
				? reached && slice.amount > mark
					? 'over'
					: 'within'
				: reached
					? 'met'
					: 'short';
		const gap = abs(sub(slice.amount, mark));
		const fill =
			mark > 0 ? Math.min(100, percentOf(slice.amount, mark)) : slice.amount > 0 ? 100 : 0;
		return {
			cls: slice.cls,
			label: slice.label,
			note: CLASS_NOTE[slice.cls],
			amount: slice.amount,
			mark,
			percent: slice.percent,
			target: slice.target,
			state,
			gap,
			fill
		};
	});
}
