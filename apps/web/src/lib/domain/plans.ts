/**
 * A plan for the month — Rozdělení příjmu, the planner (Q69).
 *
 * The book's instruction is that income has a shape decided *before* the
 * month starts. `/prehled` measures the shape a month ended up with; a plan
 * is the shape on paper: what comes in, line by line, what is committed, line
 * by line, and what that leaves — the figure the whole screen is for, **pro
 * mě**, the money that is actually yours to live on.
 *
 * Two rules do the work:
 *
 * **A line costs what it costs *you*.** The mortgage is 28 000 and the
 * roommate pays 14 000 of it back every month; the whole 28 000 leaves the
 * account, and the line commits 14 000. `paidBack` is the same idea a
 * declared schedule carries as its shares (Q46, Q47), so a plan can be built
 * from the standing orders with the roommate already on it.
 *
 * **The book's ruler, not a new one.** Every expense line carries the same
 * `spendType` a bucket does, so the plan reads in the four classes the month
 * is measured in — and the three decisions are held against 10 % of the
 * income each, the way `/prehled` holds a finished month against them.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import { formatMonthHeading, type IsoDate } from './datetime';
import { uuidv7 } from './ids';
import {
	HOME_CURRENCY,
	ZERO,
	abs,
	formatMoney,
	minor,
	mulRatio,
	percentOf,
	sub,
	sum,
	type Minor
} from './money';
import {
	CLASS_LABEL,
	CLASS_NOTE,
	PROSPERITY_CLASSES,
	TARGET_SHARE,
	classOf,
	shareAmount,
	type ProsperityClass
} from './prosperity';
import { scheduleSharesOf } from './recurring';
import type { Category, PlanLine, Schedule } from './types';

/** More than this is not a plan, it is a ledger. */
export const MAX_PLAN_LINES = 40;

/** What a line commits: an expense net of what comes back, an income whole. */
export function lineNet(line: PlanLine): Minor {
	if (line.kind === 'income') return abs(line.amount);
	const back = Math.min(Math.max(line.paidBack, 0), Math.abs(line.amount));
	return minor(Math.abs(line.amount) - back);
}

export interface PlanClass {
	cls: ProsperityClass;
	label: string;
	note: string;
	/** What the lines of this class commit, net of what comes back. */
	amount: Minor;
	/** Share of income, rounded. Zero without income. */
	percent: number;
	target: number;
	/** The book's figure for this class from this income. */
	targetAmount: Minor;
	/** `percent - target`. Negative = under the mark. */
	delta: number;
}

export interface PlanSummary {
	income: Minor;
	hasIncome: boolean;
	/** Every expense line, whole — what leaves the account. */
	gross: Minor;
	/** What other people put back. */
	paidBack: Minor;
	/** `gross - paidBack` — what the month costs you. */
	committed: Minor;
	/** `income - committed`. Pro mě. Negative when the plan spends more than comes in. */
	left: Minor;
	/** `left` as a share of income, signed. */
	leftPercent: number;
	/** `left` spread over the month's days, when there is something to spread. */
	perDay: Minor | null;
	need: Minor;
	want: Minor;
	classes: PlanClass[];
	/** The decision furthest below the book's mark. Null when none is short. */
	weakest: PlanClass | null;
}

export interface SummariseInput {
	lines: readonly PlanLine[];
	/** Days in the month the plan is read against — `daysInMonth()`. */
	days: number;
}

export function summarisePlan(input: SummariseInput): PlanSummary {
	const incomes = input.lines.filter((l) => l.kind === 'income');
	const expenses = input.lines.filter((l) => l.kind === 'expense');

	const income = sum(incomes.map((l) => abs(l.amount)));
	const hasIncome = income > 0;
	const gross = sum(expenses.map((l) => abs(l.amount)));
	const committed = sum(expenses.map(lineNet));
	const paidBack = sub(gross, committed);
	const left = sub(income, committed);
	const leftPercent = hasIncome ? Math.sign(left) * percentOf(left, income) : 0;
	const perDay = left > 0 && input.days > 0 ? mulRatio(left, 1, input.days) : null;

	const byClass = new Map<ProsperityClass, Minor>(PROSPERITY_CLASSES.map((c) => [c, ZERO]));
	let need = ZERO;
	let want = ZERO;
	for (const line of expenses) {
		const net = lineNet(line);
		const cls = classOf(line.spendType);
		byClass.set(cls, minor((byClass.get(cls) ?? ZERO) + net));
		if (line.spendType === 'want') want = minor(want + net);
		else if (cls === 'live') need = minor(need + net);
	}

	const classes: PlanClass[] = PROSPERITY_CLASSES.map((cls) => {
		const amount = byClass.get(cls) ?? ZERO;
		const percent = hasIncome ? percentOf(amount, income) : 0;
		return {
			cls,
			label: CLASS_LABEL[cls],
			note: CLASS_NOTE[cls],
			amount,
			percent,
			target: TARGET_SHARE[cls],
			targetAmount: shareAmount(income, TARGET_SHARE[cls]),
			delta: hasIncome ? percent - TARGET_SHARE[cls] : 0
		};
	});

	// Same reading as `prosperitySplit`: only the three decisions can be short.
	// Living under 70 % is not a failure, it is the point.
	const shortfalls = hasIncome
		? classes.filter((c) => c.cls !== 'live' && c.delta < 0).sort((a, b) => a.delta - b.delta)
		: [];

	return {
		income,
		hasIncome,
		gross,
		paidBack,
		committed,
		left,
		leftPercent,
		perDay,
		need,
		want,
		classes,
		weakest: shortfalls[0] ?? null
	};
}

/** One line of Czech: what the plan says, in the order that matters. */
export function planVerdict(summary: PlanSummary, code: string = HOME_CURRENCY): string {
	if (!summary.hasIncome) return 'Bez příjmu není co rozdělovat.';
	if (summary.left < 0) return `Závazky jsou o ${-summary.leftPercent} % vyšší než příjem.`;
	if (summary.weakest) {
		const { label, percent, target, targetAmount } = summary.weakest;
		return `${label}: ${percent} % místo ${target} %. Kniha by sem z tohohle příjmu dala ${formatMoney(targetAmount, { code })}.`;
	}
	return `Tři podíly sedí. Pro tebe zbývá ${summary.leftPercent} % příjmu.`;
}

/**
 * What a plan may be saved with.
 *
 * A line with nothing on it — no name, no amount — is a row somebody opened
 * and walked away from, and is dropped. A line with an amount and no name is
 * kept: the figure is the part that was worth typing. An expense cannot have
 * more paid back than it costs, and an income pays nothing back.
 */
export function cleanLines(lines: readonly PlanLine[]): PlanLine[] {
	return lines
		.map((line): PlanLine => {
			const amount = abs(line.amount);
			const expense = line.kind === 'expense';
			return {
				id: line.id,
				kind: line.kind,
				name: line.name.trim(),
				amount,
				spendType: expense ? line.spendType : 'need',
				paidBack: expense ? minor(Math.min(Math.max(line.paidBack, 0), amount)) : ZERO
			};
		})
		.filter((line) => line.name !== '' || line.amount > 0)
		.slice(0, MAX_PLAN_LINES);
}

export interface FromSchedulesInput {
	schedules: readonly Schedule[];
	categories: readonly Category[];
	/** The plan's account. A schedule with no account belongs to every plan. */
	accountId: string | null;
	/** Id generator, for tests. */
	id?: () => string;
}

/**
 * The standing orders as plan lines — the one-tap start.
 *
 * The declared payments already know what they cost, what class their bucket
 * is in, and who pays a share back; a plan that starts from them starts with
 * the roommate on it. Every live schedule for the account, in the order the
 * Platby screen lists them.
 */
export function linesFromSchedules(input: FromSchedulesInput): PlanLine[] {
	const nextId = input.id ?? uuidv7;
	const categoryById = new Map(input.categories.map((c) => [c.id, c]));

	return input.schedules
		.filter((s) => !s.isDeleted && !s.isArchived)
		.filter((s) => !input.accountId || !s.accountId || s.accountId === input.accountId)
		.slice()
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((schedule): PlanLine => {
			const amount = abs(schedule.amount);
			if (schedule.amount > 0) {
				return {
					id: nextId(),
					kind: 'income',
					name: schedule.payee,
					amount,
					spendType: 'need',
					paidBack: ZERO
				};
			}
			const back = sum(scheduleSharesOf(schedule).map((s) => abs(s.amount)));
			return {
				id: nextId(),
				kind: 'expense',
				name: schedule.payee,
				amount,
				spendType: categoryById.get(schedule.categoryId)?.spendType ?? 'need',
				paidBack: minor(Math.min(back, amount))
			};
		});
}

/** "Plán · září 2026" — what a plan is called when nobody named it. */
export function defaultPlanName(today: IsoDate): string {
	return `Plán · ${formatMonthHeading(today)}`;
}
