/**
 * Recurring payments — declared, not detected.
 *
 * `checks.ts` → `findMissingRecurring` already notices repetition, and it can
 * only ever be statistical: a payee seen in three months and missing from a
 * fourth becomes a question. A schedule is the other half of that. It states
 * what is owed, to whom, out of which bucket and on which day, so a payment
 * that did not arrive is a fact rather than an inference — and so twelve
 * subscriptions stop being twelve things retyped by hand every month, which is
 * exactly the friction the spreadsheet died of.
 *
 * Two things this module is careful about:
 *
 * **It never invents a payment the app was not around for.** Catch-up runs from
 * the schedule's own watermark forward, capped, and a month is only due once
 * its day has actually passed. The date on the row is the day *declared* — the
 * app has no way to know when the bank really moved the money, and pretending
 * otherwise is what reconciliation exists to catch.
 *
 * **The annual figure is the point.** `379 Kč/měs` is a rounding error;
 * `4 548 Kč/rok` is a decision, and it is the number the Trimming law acts on.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { daysInMonth, monthKey, shiftMonth, type IsoDate } from './datetime';
import { ZERO, abs, sum, type Minor } from './money';
import type { Schedule } from './types';

export const MODE_LABEL: Record<Schedule['mode'], string> = {
	confirm: 'potvrdit',
	auto: 'automaticky'
};

/**
 * How far back a catch-up will reach.
 *
 * A phone left in a drawer over the summer should come back with its standing
 * orders recorded. A schedule back-dated to 2019 by a mistyped start month
 * should not silently write sixty rows into the ledger, so the reach is bounded
 * and the surplus is reported rather than posted.
 */
export const MAX_CATCH_UP_MONTHS = 12;

export interface DueItem {
	schedule: Schedule;
	/** The month this instance belongs to. YYYY-MM. */
	month: string;
	/** The date the row will carry: `dayOfMonth`, clamped into that month. */
	date: IsoDate;
}

/** The 31st of a 30-day month is the 30th. Nothing is ever moved into the next. */
export function dueDate(month: string, dayOfMonth: number): IsoDate {
	const day = Math.min(Math.max(1, Math.trunc(dayOfMonth)), daysInMonth(month));
	return `${month}-${String(day).padStart(2, '0')}`;
}

export interface DueInput {
	schedules: readonly Schedule[];
	today: IsoDate;
	maxMonths?: number;
}

/**
 * Everything a schedule owes the ledger, oldest first.
 *
 * A month is due when its day has passed and the schedule has not been settled
 * for it — settled meaning a row was posted *or* the month was deliberately
 * skipped. Both move the same watermark, because "I already typed this one" and
 * "we did not pay it this month" are the same fact as far as the next launch is
 * concerned.
 */
export function dueSchedules({ schedules, today, maxMonths }: DueInput): DueItem[] {
	const cap = maxMonths ?? MAX_CATCH_UP_MONTHS;
	const now = monthKey(today);
	const items: DueItem[] = [];

	for (const schedule of schedules) {
		if (schedule.isDeleted || schedule.isArchived) continue;

		// The first month still owed: after the watermark, or the start month.
		const after = schedule.lastPostedMonth ? shiftMonth(schedule.lastPostedMonth, 1) : null;
		let month = after && after > schedule.startMonth ? after : schedule.startMonth;

		// Never reach further back than the cap, however old the watermark is.
		const floor = shiftMonth(now, -(cap - 1));
		if (month < floor) month = floor;

		for (let step = 0; step < cap && month <= now; step += 1) {
			if (schedule.endMonth && month > schedule.endMonth) break;

			const date = dueDate(month, schedule.dayOfMonth);
			// The current month only counts once its day has actually arrived.
			if (date > today) break;

			items.push({ schedule, month, date });
			month = shiftMonth(month, 1);
		}
	}

	return items.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
}

/**
 * One row per schedule — the oldest month it still owes.
 *
 * The confirmation strip works one instance at a time on purpose. The watermark
 * is a high-water mark, so confirming August before July would mark July settled
 * without ever showing it. Oldest-first, one at a time, and the next appears
 * when this one is dealt with.
 */
export interface DueGroup {
	item: DueItem;
	/** How many further months this schedule still owes behind this one. */
	backlog: number;
}

export function dueGroups(input: DueInput): DueGroup[] {
	const bySchedule = new Map<string, DueItem[]>();
	for (const item of dueSchedules(input)) {
		const list = bySchedule.get(item.schedule.id);
		if (list) list.push(item);
		else bySchedule.set(item.schedule.id, [item]);
	}

	return [...bySchedule.values()]
		.map((items) => ({ item: items[0]!, backlog: items.length - 1 }))
		.sort((a, b) => (a.item.date === b.item.date ? 0 : a.item.date < b.item.date ? -1 : 1));
}

/** What posts without being asked, and what waits to be looked at. */
export function partitionByMode(items: readonly DueItem[]): {
	auto: DueItem[];
	confirm: DueItem[];
} {
	return {
		auto: items.filter((i) => i.schedule.mode === 'auto'),
		confirm: items.filter((i) => i.schedule.mode === 'confirm')
	};
}

// ── what it costs ───────────────────────────────────────────────────────────

export interface RecurringCost {
	schedule: Schedule;
	/** Positive magnitude per month. */
	monthly: Minor;
	/** The number that changes decisions. */
	yearly: Minor;
}

export interface RecurringTotal {
	rows: RecurringCost[];
	monthly: Minor;
	yearly: Minor;
}

/**
 * The standing cost of everything declared, per month and per year.
 *
 * Outflows only. A salary on a schedule is a real and useful thing to declare,
 * but adding it here would net the two off and produce a figure that answers no
 * question anybody asks.
 */
export function recurringCost(schedules: readonly Schedule[]): RecurringTotal {
	const rows = schedules
		.filter((s) => !s.isDeleted && !s.isArchived && s.amount < 0)
		.sort((a, b) => a.amount - b.amount)
		.map((schedule) => {
			const monthly = abs(schedule.amount);
			return { schedule, monthly, yearly: (monthly * 12) as Minor };
		});

	return {
		rows,
		monthly: rows.length ? sum(rows.map((r) => r.monthly)) : ZERO,
		yearly: rows.length ? sum(rows.map((r) => r.yearly)) : ZERO
	};
}

/**
 * Payments still to come this month, on schedules that have not gone out yet.
 *
 * The month total on the launch screen answers "what has happened"; this
 * answers "what is still coming", which on the 3rd is most of it.
 */
export function remainingThisMonth(schedules: readonly Schedule[], today: IsoDate): Minor {
	const now = monthKey(today);
	const pending = schedules.filter((schedule) => {
		if (schedule.isDeleted || schedule.isArchived || schedule.amount >= 0) return false;
		if (schedule.startMonth > now) return false;
		if (schedule.endMonth && schedule.endMonth < now) return false;
		if (schedule.lastPostedMonth && schedule.lastPostedMonth >= now) return false;
		return dueDate(now, schedule.dayOfMonth) > today;
	});

	return pending.length ? sum(pending.map((s) => abs(s.amount))) : ZERO;
}

/**
 * How many payments a schedule with an end date has left, and what they add up
 * to — a mortgage answering "how much of this is still ahead of me" out of the
 * ledger alone, without a second kind of stated number.
 */
export interface Remaining {
	payments: number;
	total: Minor;
	endMonth: string;
}

export function remainingPayments(schedule: Schedule, today: IsoDate): Remaining | null {
	if (!schedule.endMonth) return null;

	const now = monthKey(today);
	const settled = schedule.lastPostedMonth;
	let from = settled ? shiftMonth(settled, 1) : schedule.startMonth;
	if (from < now) from = now;
	if (from > schedule.endMonth) return { payments: 0, total: ZERO, endMonth: schedule.endMonth };

	// Whole months from `from` to `endMonth`, inclusive.
	const [fy, fm] = from.split('-').map(Number) as [number, number];
	const [ey, em] = schedule.endMonth.split('-').map(Number) as [number, number];
	const payments = (ey - fy) * 12 + (em - fm) + 1;

	return {
		payments,
		total: (abs(schedule.amount) * payments) as Minor,
		endMonth: schedule.endMonth
	};
}
