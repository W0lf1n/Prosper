import { describe, expect, it } from 'vitest';
import {
	MAX_CATCH_UP_MONTHS,
	dueDate,
	dueGroups,
	dueSchedules,
	partitionByMode,
	netOfSchedule,
	recurringCost,
	recurringIncome,
	remainingPayments,
	remainingThisMonth,
	scheduleSharesOf,
	sharesForPosting
} from './recurring';
import { minor } from './money';
import type { Schedule, ScheduleShare } from './types';

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'dev', isDeleted: false };

function schedule(id: string, patch: Partial<Schedule> = {}): Schedule {
	return {
		id,
		payee: id,
		categoryId: 'cat',
		amount: minor(-379_00),
		dayOfMonth: 15,
		startMonth: '2026-01',
		endMonth: null,
		mode: 'confirm',
		shares: [],
		lastPostedMonth: null,
		isArchived: false,
		sortOrder: 0,
		...SYNCED,
		...patch
	};
}

let shareSeq = 0;

function share(amount: number, who = ''): ScheduleShare {
	shareSeq += 1;
	return { id: `share-${shareSeq}`, who, amount: minor(amount) };
}

const TODAY = '2026-08-25';

describe('dueDate', () => {
	it('clamps into short months rather than spilling into the next one', () => {
		expect(dueDate('2026-02', 31)).toBe('2026-02-28');
		expect(dueDate('2026-04', 31)).toBe('2026-04-30');
		expect(dueDate('2026-01', 31)).toBe('2026-01-31');
	});

	it('pads a single digit', () => {
		expect(dueDate('2026-08', 5)).toBe('2026-08-05');
	});

	it('refuses a day out of range instead of producing a broken date', () => {
		expect(dueDate('2026-08', 0)).toBe('2026-08-01');
		expect(dueDate('2026-08', 99)).toBe('2026-08-31');
	});
});

describe('dueSchedules', () => {
	it('is due once the day has passed', () => {
		const items = dueSchedules({
			schedules: [schedule('netflix', { lastPostedMonth: '2026-07' })],
			today: TODAY
		});
		expect(items).toHaveLength(1);
		expect(items[0]!.month).toBe('2026-08');
		expect(items[0]!.date).toBe('2026-08-15');
	});

	it('is due on the day itself, not the day after', () => {
		const items = dueSchedules({
			schedules: [schedule('rent', { dayOfMonth: 15, lastPostedMonth: '2026-07' })],
			today: '2026-08-15'
		});
		expect(items).toHaveLength(1);
	});

	it('is not due while its day is still ahead', () => {
		const items = dueSchedules({
			schedules: [schedule('rent', { dayOfMonth: 28, lastPostedMonth: '2026-07' })],
			today: TODAY
		});
		expect(items).toEqual([]);
	});

	it('says nothing once the month is settled', () => {
		const items = dueSchedules({
			schedules: [schedule('netflix', { lastPostedMonth: '2026-08' })],
			today: TODAY
		});
		expect(items).toEqual([]);
	});

	it('catches up every month the app was closed for', () => {
		const items = dueSchedules({
			schedules: [schedule('rent', { lastPostedMonth: '2026-04' })],
			today: TODAY
		});
		expect(items.map((i) => i.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
	});

	it('never reaches back further than the cap', () => {
		const items = dueSchedules({
			schedules: [schedule('old', { startMonth: '2019-01' })],
			today: TODAY
		});
		expect(items).toHaveLength(MAX_CATCH_UP_MONTHS);
		// The window ends on the current month, so it starts eleven months back.
		expect(items[0]!.month).toBe('2025-09');
		expect(items.at(-1)!.month).toBe('2026-08');
	});

	it('never starts before the schedule does', () => {
		const items = dueSchedules({
			schedules: [schedule('new', { startMonth: '2026-07' })],
			today: TODAY
		});
		expect(items.map((i) => i.month)).toEqual(['2026-07', '2026-08']);
	});

	it('is silent before its start month', () => {
		const items = dueSchedules({
			schedules: [schedule('later', { startMonth: '2026-12' })],
			today: TODAY
		});
		expect(items).toEqual([]);
	});

	it('stops at the end month', () => {
		const items = dueSchedules({
			schedules: [schedule('loan', { lastPostedMonth: '2026-04', endMonth: '2026-06' })],
			today: TODAY
		});
		expect(items.map((i) => i.month)).toEqual(['2026-05', '2026-06']);
	});

	it('ignores archived and deleted schedules', () => {
		const items = dueSchedules({
			schedules: [
				schedule('gone', { isDeleted: true }),
				schedule('hidden', { isArchived: true, lastPostedMonth: '2026-07' })
			],
			today: TODAY
		});
		expect(items).toEqual([]);
	});

	it('orders everything oldest first, across schedules', () => {
		const items = dueSchedules({
			schedules: [
				schedule('late', { dayOfMonth: 20, lastPostedMonth: '2026-07' }),
				schedule('early', { dayOfMonth: 2, lastPostedMonth: '2026-07' })
			],
			today: TODAY
		});
		expect(items.map((i) => i.schedule.id)).toEqual(['early', 'late']);
	});

	it('clamps the row date into a short month', () => {
		const items = dueSchedules({
			schedules: [schedule('rent', { dayOfMonth: 31, lastPostedMonth: '2026-01' })],
			today: '2026-03-01'
		});
		expect(items.map((i) => i.date)).toEqual(['2026-02-28']);
	});
});

describe('dueGroups', () => {
	it('offers one instance per schedule and counts the rest', () => {
		const groups = dueGroups({
			schedules: [
				schedule('rent', { lastPostedMonth: '2026-05' }),
				schedule('netflix', { lastPostedMonth: '2026-07' })
			],
			today: TODAY
		});

		expect(groups).toHaveLength(2);
		// Oldest owed first — the watermark only moves forward, so August must
		// never be confirmed before June.
		expect(groups[0]!.item.schedule.id).toBe('rent');
		expect(groups[0]!.item.month).toBe('2026-06');
		expect(groups[0]!.backlog).toBe(2);
		expect(groups[1]!.backlog).toBe(0);
	});
});

describe('partitionByMode', () => {
	it('separates what posts itself from what waits', () => {
		const items = dueSchedules({
			schedules: [
				schedule('hypo', { mode: 'auto', lastPostedMonth: '2026-07' }),
				schedule('netflix', { mode: 'confirm', lastPostedMonth: '2026-07' })
			],
			today: TODAY
		});
		const { auto, confirm } = partitionByMode(items);
		expect(auto.map((i) => i.schedule.id)).toEqual(['hypo']);
		expect(confirm.map((i) => i.schedule.id)).toEqual(['netflix']);
	});
});

describe('recurringCost', () => {
	it('gives the year, which is the number that decides anything', () => {
		const total = recurringCost([
			schedule('netflix', { amount: minor(-379_00) }),
			schedule('hypo', { amount: minor(-27_000_00) })
		]);

		expect(total.rows[0]!.schedule.id).toBe('hypo'); // biggest first
		expect(total.rows[0]!.yearly).toBe(324_000_00);
		expect(total.rows[1]!.yearly).toBe(4_548_00);
		expect(total.monthly).toBe(27_379_00);
		expect(total.yearly).toBe(328_548_00);
	});

	it('leaves income out rather than netting it off', () => {
		const total = recurringCost([
			schedule('salary', { amount: minor(60_000_00) }),
			schedule('netflix', { amount: minor(-379_00) })
		]);
		expect(total.rows).toHaveLength(1);
		expect(total.monthly).toBe(379_00);
	});

	it('is zero, not NaN, with nothing declared', () => {
		expect(recurringCost([]).yearly).toBe(0);
	});

	it('counts a shared payment at what it actually costs', () => {
		// The mortgage paid whole, halved by the person it is halved with. The
		// balance sees 32 000 on the 15th; the decision is made against 16 000.
		const total = recurringCost([
			schedule('hypo', { amount: minor(-32_000_00), shares: [share(16_000_00, 'Jana')] })
		]);

		const row = total.rows[0]!;
		expect(row.monthly).toBe(32_000_00);
		expect(row.reimbursed).toBe(16_000_00);
		expect(row.net).toBe(16_000_00);
		expect(row.yearly).toBe(192_000_00);
		expect(row.grossYearly).toBe(384_000_00);

		expect(total.monthly).toBe(32_000_00);
		expect(total.reimbursed).toBe(16_000_00);
		expect(total.net).toBe(16_000_00);
		expect(total.yearly).toBe(192_000_00);
	});

	it('never lets shares turn a payment into income', () => {
		const total = recurringCost([
			schedule('odd', { amount: minor(-1_000_00), shares: [share(4_000_00)] })
		]);

		expect(total.rows[0]!.net).toBe(0);
		expect(total.rows[0]!.reimbursed).toBe(1_000_00);
	});
});

describe('netOfSchedule', () => {
	it('is the whole payment when nothing comes back', () => {
		expect(netOfSchedule(schedule('netflix', { amount: minor(-379_00) }))).toBe(379_00);
	});

	it('subtracts the declared share', () => {
		expect(
			netOfSchedule(schedule('hypo', { amount: minor(-32_000_00), shares: [share(12_500_00)] }))
		).toBe(19_500_00);
	});

	it('subtracts every payer of a split subscription — Q47', () => {
		expect(
			netOfSchedule(
				schedule('netflix', {
					amount: minor(-399_00),
					shares: [share(133_00, 'Kerhy'), share(133_00, 'Zůza')]
				})
			)
		).toBe(133_00);
	});
});

describe('scheduleSharesOf — the legacy fallback', () => {
	it('synthesises the single share of a pre-v9 schedule', () => {
		const old: Record<string, unknown> = { ...schedule('hypo', { amount: minor(-32_000_00) }) };
		delete old.shares;
		old.owedAmount = 16_000_00;
		old.owedBy = 'Jana';

		expect(scheduleSharesOf(old as unknown as Schedule)).toEqual([
			{ id: 'legacy', who: 'Jana', amount: 16_000_00 }
		]);
		expect(netOfSchedule(old as unknown as Schedule)).toBe(16_000_00);
	});

	it('reads an unshared legacy schedule as an empty list', () => {
		const old: Record<string, unknown> = { ...schedule('netflix') };
		delete old.shares;
		old.owedAmount = null;
		old.owedBy = null;
		expect(scheduleSharesOf(old as unknown as Schedule)).toEqual([]);
	});
});

describe('sharesForPosting', () => {
	it('copies the declared shares onto an ordinary posting', () => {
		const netflix = schedule('netflix', {
			amount: minor(-399_00),
			shares: [share(133_00, 'Kerhy'), share(133_00, 'Zůza')]
		});
		expect(sharesForPosting(netflix, minor(-399_00))).toEqual([
			{ who: 'Kerhy', amount: 133_00 },
			{ who: 'Zůza', amount: 133_00 }
		]);
	});

	it('never books back more than went out on an overridden amount', () => {
		const netflix = schedule('netflix', {
			amount: minor(-399_00),
			shares: [share(133_00, 'Kerhy'), share(133_00, 'Zůza')]
		});
		// Confirmed at 200: the first share fits, the second is clamped to the rest.
		expect(sharesForPosting(netflix, minor(-200_00))).toEqual([
			{ who: 'Kerhy', amount: 133_00 },
			{ who: 'Zůza', amount: 67_00 }
		]);
		// Confirmed at 100: only the first share, clamped, survives.
		expect(sharesForPosting(netflix, minor(-100_00))).toEqual([{ who: 'Kerhy', amount: 100_00 }]);
	});

	it('gives an incoming amount no shares at all', () => {
		const odd = schedule('odd', { shares: [share(133_00, 'Kerhy')] });
		expect(sharesForPosting(odd, minor(399_00))).toEqual([]);
	});
});

describe('recurringIncome', () => {
	it('lists what arrives on its own, biggest first', () => {
		const total = recurringIncome([
			schedule('najem', { amount: minor(8_500_00) }),
			schedule('vratka', { amount: minor(16_000_00) }),
			schedule('netflix', { amount: minor(-379_00) })
		]);

		expect(total.rows.map((r) => r.schedule.id)).toEqual(['vratka', 'najem']);
		expect(total.monthly).toBe(24_500_00);
		expect(total.yearly).toBe(294_000_00);
	});

	it('skips what is archived or deleted', () => {
		const total = recurringIncome([
			schedule('gone', { amount: minor(8_500_00), isArchived: true }),
			schedule('dead', { amount: minor(8_500_00), isDeleted: true })
		]);

		expect(total.rows).toHaveLength(0);
		expect(total.monthly).toBe(0);
	});

	it('is zero, not NaN, with nothing declared', () => {
		expect(recurringIncome([]).yearly).toBe(0);
	});
});

describe('remainingThisMonth', () => {
	it('counts what is still ahead this month', () => {
		const value = remainingThisMonth(
			[
				schedule('paid', { dayOfMonth: 5, amount: minor(-1_000_00), lastPostedMonth: '2026-08' }),
				schedule('coming', { dayOfMonth: 28, amount: minor(-2_500_00) })
			],
			TODAY
		);
		expect(value).toBe(2_500_00);
	});

	it('does not count a payment whose day has already gone', () => {
		expect(remainingThisMonth([schedule('past', { dayOfMonth: 3 })], TODAY)).toBe(0);
	});

	it('ignores income and finished schedules', () => {
		const value = remainingThisMonth(
			[
				schedule('salary', { dayOfMonth: 28, amount: minor(60_000_00) }),
				schedule('ended', { dayOfMonth: 28, endMonth: '2026-06' })
			],
			TODAY
		);
		expect(value).toBe(0);
	});
});

describe('remainingPayments', () => {
	it('is null without an end month — most subscriptions have none', () => {
		expect(remainingPayments(schedule('netflix'), TODAY)).toBeNull();
	});

	it('counts the months left, inclusive, and what they add up to', () => {
		const left = remainingPayments(
			schedule('hypo', { amount: minor(-27_000_00), endMonth: '2026-11' }),
			TODAY
		);
		// August through November.
		expect(left).toEqual({ payments: 4, total: 108_000_00, endMonth: '2026-11' });
	});

	it('starts after the last settled month', () => {
		const left = remainingPayments(
			schedule('hypo', {
				amount: minor(-27_000_00),
				endMonth: '2026-11',
				lastPostedMonth: '2026-08'
			}),
			TODAY
		);
		expect(left!.payments).toBe(3);
	});

	it('spans a year boundary', () => {
		const left = remainingPayments(
			schedule('hypo', { amount: minor(-10_000_00), endMonth: '2027-02' }),
			TODAY
		);
		// 2026-08 … 2027-02
		expect(left!.payments).toBe(7);
		expect(left!.total).toBe(70_000_00);
	});

	it('is finished once the end month has passed', () => {
		const left = remainingPayments(schedule('done', { endMonth: '2026-03' }), TODAY);
		expect(left).toEqual({ payments: 0, total: 0, endMonth: '2026-03' });
	});
});
