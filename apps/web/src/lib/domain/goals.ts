/**
 * Targeting — *unwritten goals are wishes* (PROJECT-PLAN §2.2).
 *
 * The law has three parts and this module is all three:
 *
 *   1. A goal is not saveable without a why, an amount and a date. The refusal
 *      is the mechanism — `validateGoal` is what the form asks before it lets
 *      anything through.
 *   2. A goal spread over a horizon is still abstract. `monthTarget` is the
 *      number for *this* month, which is the only horizon a person actually
 *      acts on.
 *   3. Progress is measured from the ledger that already exists, not from a
 *      second set of books: money that landed in the goal's bucket counts, and
 *      nothing else does.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { ZERO, abs, minor, mulRatio, sum, type Minor } from './money';
import { daysInMonth, monthKey, monthsUntil, today as todayIso, type IsoDate } from './datetime';
import { normalize } from './vocabulary';
import type { Category, Goal, MonthTarget, Txn } from './types';

/** Minimum length of a why. Short enough to type, long enough to mean something. */
export const WHY_MIN_LENGTH = 10;

// ── writing a goal down ─────────────────────────────────────────────────────

export interface GoalDraft {
	name: string;
	why: string;
	/** Positive magnitude. */
	targetAmount: Minor;
	targetDate: IsoDate;
}

export type GoalProblem = 'name' | 'why' | 'amount' | 'date';

/**
 * What is still missing before this is a goal rather than a wish.
 *
 * All four are refusals, not warnings. This is the one place in the app where
 * something is allowed to block a save — a half-written goal is not a record of
 * anything, unlike a half-described expense, which at least holds the amount.
 */
export function validateGoal(draft: GoalDraft, today: IsoDate = todayIso()): GoalProblem[] {
	const problems = validateGoalShape(draft);
	if (!draft.targetDate || draft.targetDate <= today) problems.push('date');
	return problems;
}

/**
 * The parts that stay true whenever you look at them.
 *
 * Split out because editing an existing goal must not be blocked by its own
 * deadline having passed — a target you missed is still a target, and moving
 * the date is one of the things you might well be there to do.
 */
export function validateGoalShape(draft: Omit<GoalDraft, 'targetDate'>): GoalProblem[] {
	const problems: GoalProblem[] = [];
	if (!draft.name.trim()) problems.push('name');
	if (draft.why.trim().length < WHY_MIN_LENGTH) problems.push('why');
	if (!(draft.targetAmount > 0)) problems.push('amount');
	return problems;
}

/** The Czech sentence the form shows for each refusal. */
export function goalProblemText(problem: GoalProblem): string {
	switch (problem) {
		case 'name':
			return 'Pojmenuj cíl.';
		case 'why':
			return `Napiš proč — aspoň ${WHY_MIN_LENGTH} znaků. Bez důvodu to nepřežije první špatný měsíc.`;
		case 'amount':
			return 'Kolik? Cíl bez částky se nedá změřit.';
		case 'date':
			return 'Do kdy? Termín v budoucnosti, jinak to není cíl.';
	}
}

// ── measuring it ────────────────────────────────────────────────────────────

/**
 * The buckets that count as putting money aside for this goal.
 *
 * An explicit category wins. Otherwise everything typed `save` counts, which is
 * why SPOŘENÍ was pulled out of OSTATNÍ in the first place (DECISIONS.md, Q24).
 */
export function goalCategoryIds(goal: Goal, categories: readonly Category[]): string[] {
	if (goal.categoryId) return [goal.categoryId];
	return categories
		.filter((c) => !c.isDeleted && !c.isIncome && c.spendType === 'save')
		.map((c) => c.id);
}

/**
 * The bucket a new goal should point at unless told otherwise.
 *
 * SPOŘENÍ by name when it exists, because that bucket was pulled out of OSTATNÍ
 * for exactly this purpose (DECISIONS.md, Q24). Otherwise the first `save`
 * bucket in configured order — INVESTICE DO MĚ is savings too, but it is money
 * spent on yourself, not money kept.
 */
export function defaultGoalCategory(categories: readonly Category[]): Category | null {
	const savers = categories.filter(
		(c) => !c.isDeleted && !c.isArchived && !c.isIncome && c.spendType === 'save'
	);
	return savers.find((c) => normalize(c.name) === 'sporeni') ?? savers[0] ?? null;
}

export interface ContributionOptions {
	/** Restrict to one month, "YYYY-MM". Omit for everything since the goal started. */
	month?: string;
}

/**
 * How much has been set aside, as a positive amount.
 *
 * Contributions are outflows — money leaving the current account for the
 * savings bucket — so the sum is negated. A row that goes the other way inside
 * the same bucket is a withdrawal and nets against the total, which is exactly
 * what the "an inflow filed under a spending bucket is a refund" invariant
 * (§6.1) already means everywhere else.
 */
export function contributions(
	goal: Goal,
	txns: readonly Txn[],
	categories: readonly Category[],
	options: ContributionOptions = {}
): Minor {
	const ids = new Set(goalCategoryIds(goal, categories));
	if (ids.size === 0) return ZERO;

	const rows = txns.filter(
		(t) =>
			!t.isDeleted &&
			t.categoryId !== null &&
			ids.has(t.categoryId) &&
			t.date >= goal.startDate &&
			(options.month === undefined || monthKey(t.date) === options.month)
	);

	return minor(-sum(rows.map((t) => t.amount)));
}

/**
 * What each remaining month has to carry, rounded up.
 *
 * Rounded *up* deliberately: a number that lands a few haléře short every month
 * misses the date, and "nearly" is not a thing a target gets to be.
 */
export function requiredMonthly(remaining: Minor, months: number): Minor {
	if (remaining <= 0) return ZERO;
	if (months <= 1) return remaining;
	const base = mulRatio(remaining, 1, months);
	return base * months >= remaining ? base : minor(base + 1);
}

export type Pace = 'done' | 'on-track' | 'behind' | 'idle';

export interface GoalStatus {
	goal: Goal;
	month: string;

	/** Set aside since the goal started. Positive. */
	saved: Minor;
	/** Still to find. Positive, clamped at zero. */
	remaining: Minor;
	/** 0–100, clamped. */
	percent: number;
	isComplete: boolean;
	/** The date has passed and the money is not there. */
	isOverdue: boolean;

	/** Months from `month` through the target month, both ends counted. */
	monthsLeft: number;
	/** What every remaining month would have to carry to land on the date. */
	suggestedMonthly: Minor;

	/** This month's number — the written one when there is one, otherwise the suggestion. */
	monthTarget: Minor;
	/** True when he has actually said yes to this month's number. */
	isCommitted: boolean;
	monthSaved: Minor;
	/** Still missing this month. Positive, clamped at zero. */
	monthRemaining: Minor;
	monthPercent: number;
	/** Today included: on the last day of the month this is 1. */
	daysLeftInMonth: number;
	pace: Pace;
}

export interface GoalStatusInput {
	goal: Goal;
	txns: readonly Txn[];
	categories: readonly Category[];
	/** The written target for `month`, when one exists. */
	target?: MonthTarget | null;
	month?: string;
	today?: IsoDate;
}

export function goalStatus(input: GoalStatusInput): GoalStatus {
	const { goal, txns, categories } = input;
	const today = input.today ?? todayIso();
	const month = input.month ?? monthKey(today);

	const saved = contributions(goal, txns, categories);
	const target = abs(goal.targetAmount);
	const remaining = minor(Math.max(target - saved, 0));
	const isComplete = remaining === 0 && target > 0;
	const percent = target === 0 ? 0 : Math.min(100, Math.max(0, Math.round((saved / target) * 100)));

	const monthsLeft = monthsUntil(month, goal.targetDate);
	const suggestedMonthly = isComplete ? ZERO : requiredMonthly(remaining, monthsLeft);

	const written = input.target && !input.target.isDeleted ? abs(input.target.amount) : null;
	const monthTarget = written ?? suggestedMonthly;
	const monthSaved = contributions(goal, txns, categories, { month });
	const monthRemaining = minor(Math.max(monthTarget - monthSaved, 0));
	const monthPercent =
		monthTarget === 0
			? 0
			: Math.min(100, Math.max(0, Math.round((monthSaved / monthTarget) * 100)));

	const total = daysInMonth(month);
	const elapsed = month === monthKey(today) ? Number(today.slice(8, 10)) : total;
	const daysLeftInMonth = Math.max(0, total - elapsed + 1);

	return {
		goal,
		month,
		saved,
		remaining,
		percent,
		isComplete,
		isOverdue: !isComplete && goal.targetDate < today,
		monthsLeft,
		suggestedMonthly,
		monthTarget,
		isCommitted: written !== null,
		monthSaved,
		monthRemaining,
		monthPercent,
		daysLeftInMonth,
		pace: paceOf({ monthTarget, monthSaved, elapsed, total, isComplete })
	};
}

/**
 * Ahead of the calendar, or behind it.
 *
 * Measured against how much of the month has gone rather than against the whole
 * month, so "behind" means behind *today* — which is a thing you can still fix —
 * rather than the useless observation that the month is not over yet.
 */
function paceOf(input: {
	monthTarget: Minor;
	monthSaved: Minor;
	elapsed: number;
	total: number;
	isComplete: boolean;
}): Pace {
	const { monthTarget, monthSaved, elapsed, total, isComplete } = input;
	if (isComplete || (monthTarget > 0 && monthSaved >= monthTarget)) return 'done';
	if (monthTarget <= 0) return 'idle';
	const expected = mulRatio(monthTarget, elapsed, total);
	return monthSaved >= expected ? 'on-track' : 'behind';
}

/** One line of Czech saying where this month stands. */
export function paceText(status: GoalStatus): string {
	switch (status.pace) {
		case 'done':
			return status.isComplete ? 'Cíl je doma.' : 'Tenhle měsíc máš splněný.';
		case 'idle':
			return 'Na tenhle měsíc zatím nic nemíříš.';
		case 'on-track':
			return status.daysLeftInMonth <= 1 ? 'Poslední den, sedí to.' : 'Zatím to sedí.';
		case 'behind':
			return status.daysLeftInMonth <= 1
				? 'Poslední den měsíce a ještě to tam není.'
				: `Zbývá ${status.daysLeftInMonth} dní a chybí to.`;
	}
}

// ── choosing what to show ───────────────────────────────────────────────────

/**
 * The goal that gets the strip on the entry screen.
 *
 * **A pin wins, always.** `isPinned` is a decision and this function does not
 * get to second-guess it — not even when the goal is finished or overdue,
 * because "keep this one in front of me" is exactly the sentence somebody says
 * about a goal that is going badly. Un-pinning is one tap.
 *
 * With nothing pinned it falls back to the guess it has always made: nearest
 * deadline still open. A finished goal steps aside for the next one rather than
 * sitting there being congratulated at, and an overdue one only wins when there
 * is nothing live left — at which point it is the thing that most needs looking
 * at anyway.
 */
export function pickPrimary(statuses: readonly GoalStatus[]): GoalStatus | null {
	const live = statuses.filter((s) => !s.goal.isDeleted);
	if (live.length === 0) return null;

	const rank = (s: GoalStatus) => (s.isComplete ? 2 : s.isOverdue ? 1 : 0);
	const byDeadline = [...live].sort((a, b) => {
		const byRank = rank(a) - rank(b);
		if (byRank !== 0) return byRank;
		if (a.goal.targetDate !== b.goal.targetDate)
			return a.goal.targetDate < b.goal.targetDate ? -1 : 1;
		return a.goal.id < b.goal.id ? -1 : 1;
	});

	// Two pinned is not a state the app can produce — `pinGoal` clears the rest —
	// but a merge from another device can, briefly. The same tiebreak decides it
	// rather than whichever row Dexie handed back first.
	return byDeadline.find((s) => s.goal.isPinned) ?? byDeadline[0] ?? null;
}

/** Index the written targets by month, so a screen can look one up per row. */
export function targetsByMonth(targets: readonly MonthTarget[]): Map<string, MonthTarget> {
	const byMonth = new Map<string, MonthTarget>();
	for (const target of targets) {
		if (target.isDeleted) continue;
		const seen = byMonth.get(target.month);
		if (!seen || target.updatedAt > seen.updatedAt) byMonth.set(target.month, target);
	}
	return byMonth;
}

export interface MonthRow {
	month: string;
	/** The written target, or null when that month was never committed to. */
	target: Minor | null;
	saved: Minor;
	/** Only meaningful when there was a target. */
	met: boolean;
}

/**
 * The record: every month the goal has run, newest first.
 *
 * This is the part that turns Targeting into Training — a row of months you can
 * see is a row of months you can be consistent about.
 */
export function monthHistory(
	goal: Goal,
	txns: readonly Txn[],
	categories: readonly Category[],
	targets: readonly MonthTarget[],
	today: IsoDate = todayIso()
): MonthRow[] {
	const written = targetsByMonth(targets.filter((t) => t.goalId === goal.id));
	const months = new Set<string>([monthKey(goal.startDate), monthKey(today), ...written.keys()]);

	for (const txn of txns) {
		if (txn.isDeleted || txn.date < goal.startDate) continue;
		months.add(monthKey(txn.date));
	}

	const ids = new Set(goalCategoryIds(goal, categories));
	return [...months]
		.filter((month) => month <= monthKey(today) && month >= monthKey(goal.startDate))
		.sort()
		.reverse()
		.map((month) => {
			const saved = minor(
				-sum(
					txns
						.filter(
							(t) =>
								!t.isDeleted &&
								t.categoryId !== null &&
								ids.has(t.categoryId) &&
								t.date >= goal.startDate &&
								monthKey(t.date) === month
						)
						.map((t) => t.amount)
				)
			);
			const target = written.get(month);
			const amount = target ? abs(target.amount) : null;
			return { month, target: amount, saved, met: amount !== null && saved >= amount };
		});
}
