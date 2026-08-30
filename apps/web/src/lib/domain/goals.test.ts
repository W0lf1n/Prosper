import { describe, expect, it } from 'vitest';
import {
	contributions,
	defaultGoalCategory,
	goalCategoryIds,
	goalStatus,
	monthHistory,
	pickPrimary,
	requiredMonthly,
	targetsByMonth,
	validateGoal
} from './goals';
import { minor } from './money';
import { monthsUntil } from './datetime';
import type { Category, Goal, MonthTarget, Txn } from './types';

const SAVE = 'cat-sporeni';
const FOOD = 'cat-potraviny';

const categories: Category[] = [
	category(SAVE, 'SPOŘENÍ', 'save'),
	category('cat-investice', 'INVESTICE DO MĚ', 'save'),
	category(FOOD, 'POTRAVINY', 'need')
];

function category(id: string, name: string, spendType: Category['spendType']): Category {
	return {
		id,
		parentId: null,
		name,
		spendType,
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		updatedAt: '2026-08-01T00:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false
	};
}

let seq = 0;

function txn(amount: number, date: string, categoryId: string | null = SAVE): Txn {
	seq += 1;
	return {
		id: `txn-${seq}`,
		accountId: 'acc-1',
		date,
		amount: minor(amount),
		categoryId,
		payee: 'spoření',
		note: null,
		transferPairId: null,
		source: 'manual',
		isCleared: false,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		createdAt: `${date}T10:00:00.000Z`,
		updatedAt: `${date}T10:00:00.000Z`,
		deviceId: 'dev-1',
		isDeleted: false
	};
}

function goal(extra: Partial<Goal> = {}): Goal {
	return {
		id: 'goal-1',
		name: 'Rezerva na půl roku',
		why: 'Abych mohl dát výpověď, aniž bych panikařil.',
		targetAmount: minor(30_000_00),
		targetDate: '2027-02-28',
		linkedAccountId: null,
		categoryId: SAVE,
		startDate: '2026-08-01',
		startAmount: minor(0),
		isPinned: false,
		updatedAt: '2026-08-01T00:00:00.000Z',
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

function monthTarget(month: string, amount: number, extra: Partial<MonthTarget> = {}): MonthTarget {
	return {
		id: `mt-${month}`,
		goalId: 'goal-1',
		month,
		amount: minor(amount),
		updatedAt: `${month}-01T00:00:00.000Z`,
		deviceId: 'dev-1',
		isDeleted: false,
		...extra
	};
}

describe('writing a goal down', () => {
	it('accepts a goal that has all three', () => {
		expect(validateGoal(goal(), '2026-08-24')).toEqual([]);
	});

	// The refusal is the mechanism, not a validation nicety (PROJECT-PLAN §2.2).
	it('refuses a why that says nothing', () => {
		expect(validateGoal(goal({ why: 'protože' }), '2026-08-24')).toContain('why');
	});

	it('refuses a goal with no amount and one with no future date', () => {
		expect(validateGoal(goal({ targetAmount: minor(0) }), '2026-08-24')).toContain('amount');
		expect(validateGoal(goal({ targetDate: '2026-08-24' }), '2026-08-24')).toContain('date');
		expect(validateGoal(goal({ targetDate: '2026-01-01' }), '2026-08-24')).toContain('date');
	});

	it('refuses an unnamed goal', () => {
		expect(validateGoal(goal({ name: '   ' }), '2026-08-24')).toContain('name');
	});
});

describe('what counts as putting money aside', () => {
	it('takes the named bucket only', () => {
		expect(goalCategoryIds(goal(), categories)).toEqual([SAVE]);
	});

	it('falls back to every save bucket when none is named', () => {
		expect(goalCategoryIds(goal({ categoryId: null }), categories)).toEqual([
			SAVE,
			'cat-investice'
		]);
	});

	// SPOŘENÍ was split out of OSTATNÍ for exactly this (DECISIONS.md, Q24), so a
	// new goal points there rather than at "money spent on myself".
	it('defaults a new goal to SPOŘENÍ over the other save bucket', () => {
		expect(defaultGoalCategory(categories)?.name).toBe('SPOŘENÍ');
	});

	it('falls back to the first save bucket when SPOŘENÍ is gone', () => {
		const without = categories.filter((c) => c.id !== SAVE);
		expect(defaultGoalCategory(without)?.name).toBe('INVESTICE DO MĚ');
		expect(defaultGoalCategory([])).toBeNull();
	});

	it('counts outflows into the bucket as positive progress', () => {
		const rows = [txn(-2_000_00, '2026-08-05'), txn(-1_500_00, '2026-08-20')];
		expect(contributions(goal(), rows, categories)).toBe(3_500_00);
	});

	it('ignores other buckets and anything before the goal started', () => {
		const rows = [
			txn(-2_000_00, '2026-08-05'),
			txn(-9_999_00, '2026-08-06', FOOD),
			txn(-5_000_00, '2026-07-31') // before startDate
		];
		expect(contributions(goal(), rows, categories)).toBe(2_000_00);
	});

	// A withdrawal inside the savings bucket is a refund against it (§6.1).
	it('nets a withdrawal back out', () => {
		const rows = [txn(-2_000_00, '2026-08-05'), txn(500_00, '2026-08-25')];
		expect(contributions(goal(), rows, categories)).toBe(1_500_00);
	});

	it('can be restricted to one month', () => {
		const rows = [txn(-2_000_00, '2026-08-05'), txn(-2_000_00, '2026-09-05')];
		expect(contributions(goal(), rows, categories, { month: '2026-09' })).toBe(2_000_00);
	});
});

describe('the stated head start (Q48)', () => {
	it('counts into the total, the percent and what is left', () => {
		const status = goalStatus({
			goal: goal({ startAmount: minor(10_000_00) }),
			txns: [txn(-2_000_00, '2026-08-05')],
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.saved).toBe(12_000_00);
		expect(status.remaining).toBe(18_000_00);
		expect(status.percent).toBe(40);
		// The month's own record stays the ledger's: the head start has no month.
		expect(status.monthSaved).toBe(2_000_00);
	});

	it('can finish a goal on its own', () => {
		const status = goalStatus({
			goal: goal({ startAmount: minor(30_000_00) }),
			txns: [],
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.isComplete).toBe(true);
		expect(status.suggestedMonthly).toBe(0);
	});

	it('is signed — a pot restated downwards shrinks the total', () => {
		const status = goalStatus({
			goal: goal({ startAmount: minor(-500_00) }),
			txns: [txn(-2_000_00, '2026-08-05')],
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.saved).toBe(1_500_00);
	});

	it('never drags the total below zero', () => {
		const status = goalStatus({
			goal: goal({ startAmount: minor(-9_000_00) }),
			txns: [txn(-2_000_00, '2026-08-05')],
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.saved).toBe(0);
		expect(status.remaining).toBe(30_000_00);
	});

	it('reads a pre-v10 goal, where the field is absent, as zero', () => {
		const legacy: Record<string, unknown> = { ...goal() };
		delete legacy.startAmount;
		const status = goalStatus({
			goal: legacy as unknown as Goal,
			txns: [txn(-2_000_00, '2026-08-05')],
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.saved).toBe(2_000_00);
	});
});

describe('what a month has to carry', () => {
	it('spreads the remainder over the months left', () => {
		expect(requiredMonthly(minor(60_000_00), 6)).toBe(10_000_00);
	});

	// Rounding down by a haléř every month misses the date.
	it('rounds up rather than landing short', () => {
		expect(requiredMonthly(minor(1000), 3)).toBe(334);
		expect(334 * 3).toBeGreaterThanOrEqual(1000);
	});

	it('is the whole remainder when there is one month or less', () => {
		expect(requiredMonthly(minor(5_000_00), 1)).toBe(5_000_00);
		expect(requiredMonthly(minor(5_000_00), 0)).toBe(5_000_00);
	});

	it('is nothing once there is nothing left', () => {
		expect(requiredMonthly(minor(0), 4)).toBe(0);
	});

	it('counts both ends of the horizon', () => {
		expect(monthsUntil('2026-08', '2027-02-28')).toBe(7);
		expect(monthsUntil('2026-08', '2026-08-31')).toBe(1);
		expect(monthsUntil('2026-08', '2026-07-31')).toBe(0);
	});
});

describe('where the goal stands', () => {
	const rows = [txn(-2_000_00, '2026-08-05'), txn(-1_000_00, '2026-08-20')];

	it('reports total, remainder and the suggestion for this month', () => {
		const status = goalStatus({
			goal: goal(),
			txns: rows,
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});

		expect(status.saved).toBe(3_000_00);
		expect(status.remaining).toBe(27_000_00);
		expect(status.percent).toBe(10);
		expect(status.monthsLeft).toBe(7); // srpen .. únor
		expect(status.suggestedMonthly).toBe(3_857_15); // 27 000 / 7, rounded up
		expect(status.isCommitted).toBe(false);
		expect(status.monthTarget).toBe(status.suggestedMonthly);
	});

	it('prefers the written target over the computed one', () => {
		const status = goalStatus({
			goal: goal(),
			txns: rows,
			categories,
			target: monthTarget('2026-08', 4_000_00),
			month: '2026-08',
			today: '2026-08-24'
		});

		expect(status.isCommitted).toBe(true);
		expect(status.monthTarget).toBe(4_000_00);
		expect(status.monthSaved).toBe(3_000_00);
		expect(status.monthRemaining).toBe(1_000_00);
		expect(status.monthPercent).toBe(75);
	});

	// Behind means behind *today*, which is still fixable — not "the month is
	// not over yet", which is useless.
	it('calls the pace against how much of the month has gone', () => {
		const base = { goal: goal(), categories, month: '2026-08' } as const;
		const target = monthTarget('2026-08', 4_000_00);

		// 24 of 31 days gone, 3 000 of 4 000 in: expected is 3 096,78.
		expect(goalStatus({ ...base, txns: rows, target, today: '2026-08-24' }).pace).toBe('behind');
		// Same money, a week earlier: expected is 2 193,55.
		expect(goalStatus({ ...base, txns: rows, target, today: '2026-08-17' }).pace).toBe('on-track');
	});

	it('is done once the month is covered, and idle when nothing is aimed at', () => {
		const covered = goalStatus({
			goal: goal(),
			txns: [txn(-4_000_00, '2026-08-05')],
			categories,
			target: monthTarget('2026-08', 4_000_00),
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(covered.pace).toBe('done');

		const nothing = goalStatus({
			goal: goal(),
			txns: [],
			categories,
			target: monthTarget('2026-08', 0),
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(nothing.pace).toBe('idle');
	});

	it('counts today as a day still left', () => {
		const last = goalStatus({
			goal: goal(),
			txns: rows,
			categories,
			month: '2026-08',
			today: '2026-08-31'
		});
		expect(last.daysLeftInMonth).toBe(1);
	});

	it('clamps a goal that has been over-funded', () => {
		const status = goalStatus({
			goal: goal(),
			txns: [txn(-31_000_00, '2026-08-05')],
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.remaining).toBe(0);
		expect(status.percent).toBe(100);
		expect(status.isComplete).toBe(true);
		expect(status.suggestedMonthly).toBe(0);
	});

	it('marks a passed date with the money still missing', () => {
		const status = goalStatus({
			goal: goal({ targetDate: '2026-07-31' }),
			txns: rows,
			categories,
			month: '2026-08',
			today: '2026-08-24'
		});
		expect(status.isOverdue).toBe(true);
		expect(status.monthsLeft).toBe(0);
		expect(status.suggestedMonthly).toBe(27_000_00);
	});
});

describe('which goal gets the strip', () => {
	function statusFor(g: Goal, txns: Txn[] = []) {
		return goalStatus({ goal: g, txns, categories, month: '2026-08', today: '2026-08-24' });
	}

	it('picks the nearest open deadline', () => {
		const near = goal({ id: 'goal-near', targetDate: '2026-10-31' });
		const far = goal({ id: 'goal-far', targetDate: '2027-06-30' });
		expect(pickPrimary([statusFor(far), statusFor(near)])?.goal.id).toBe('goal-near');
	});

	it('steps a finished goal aside for a live one', () => {
		const done = goal({ id: 'goal-done', targetDate: '2026-09-30', targetAmount: minor(1_000_00) });
		const live = goal({ id: 'goal-live', targetDate: '2027-06-30' });
		const picked = pickPrimary([statusFor(done, [txn(-1_000_00, '2026-08-02')]), statusFor(live)]);
		expect(picked?.goal.id).toBe('goal-live');
	});

	it('shows an overdue goal when nothing else is open', () => {
		const overdue = goal({ id: 'goal-late', targetDate: '2026-06-30' });
		expect(pickPrimary([statusFor(overdue)])?.goal.id).toBe('goal-late');
	});

	it('has nothing to show without a goal', () => {
		expect(pickPrimary([])).toBeNull();
	});

	it('a pin beats the nearest deadline — that is the whole point of it', () => {
		const near = goal({ id: 'goal-near', targetDate: '2026-10-31' });
		const far = goal({ id: 'goal-far', targetDate: '2027-06-30', isPinned: true });
		expect(pickPrimary([statusFor(near), statusFor(far)])?.goal.id).toBe('goal-far');
	});

	it('keeps a finished goal on screen when it was pinned on purpose', () => {
		const done = goal({
			id: 'goal-done',
			targetDate: '2026-09-30',
			targetAmount: minor(1_000_00),
			isPinned: true
		});
		const live = goal({ id: 'goal-live', targetDate: '2027-06-30' });
		const picked = pickPrimary([statusFor(done, [txn(-1_000_00, '2026-08-02')]), statusFor(live)]);
		expect(picked?.goal.id).toBe('goal-done');
	});

	it('keeps an overdue pinned goal on screen — it is what most needs looking at', () => {
		const late = goal({ id: 'goal-late', targetDate: '2026-06-30', isPinned: true });
		const live = goal({ id: 'goal-live', targetDate: '2027-06-30' });
		expect(pickPrimary([statusFor(live), statusFor(late)])?.goal.id).toBe('goal-late');
	});

	/* Not a state the app can write — `pinGoal` clears the rest — but a merge
	   from a second device can produce it for one cycle. */
	it('breaks a two-pin tie the same way it breaks any other', () => {
		const near = goal({ id: 'goal-near', targetDate: '2026-10-31', isPinned: true });
		const far = goal({ id: 'goal-far', targetDate: '2027-06-30', isPinned: true });
		expect(pickPrimary([statusFor(far), statusFor(near)])?.goal.id).toBe('goal-near');
	});
});

describe('the record of months', () => {
	it('lists every month the goal has run, newest first', () => {
		const rows = [txn(-2_000_00, '2026-08-05'), txn(-3_000_00, '2026-09-10')];
		const history = monthHistory(
			goal(),
			rows,
			categories,
			[monthTarget('2026-08', 4_000_00), monthTarget('2026-09', 3_000_00)],
			'2026-09-20'
		);

		expect(history.map((r) => r.month)).toEqual(['2026-09', '2026-08']);
		expect(history[0]).toMatchObject({ target: 3_000_00, saved: 3_000_00, met: true });
		expect(history[1]).toMatchObject({ target: 4_000_00, saved: 2_000_00, met: false });
	});

	it('shows a month that was never committed to as having no target', () => {
		const history = monthHistory(goal(), [], categories, [], '2026-08-24');
		expect(history).toHaveLength(1);
		expect(history[0]!.target).toBeNull();
		expect(history[0]!.met).toBe(false);
	});

	it('keeps the newest write when a month was targeted twice', () => {
		const index = targetsByMonth([
			monthTarget('2026-08', 4_000_00),
			monthTarget('2026-08', 5_000_00, {
				id: 'mt-later',
				updatedAt: '2026-08-10T00:00:00.000Z'
			})
		]);
		expect(index.get('2026-08')?.amount).toBe(5_000_00);
	});

	it('ignores a deleted target', () => {
		expect(targetsByMonth([monthTarget('2026-08', 4_000_00, { isDeleted: true })]).size).toBe(0);
	});
});
