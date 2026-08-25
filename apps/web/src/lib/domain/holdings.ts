/**
 * Holdings — what is owned, and what it was worth the last time anyone looked.
 *
 * The whole module exists to keep one distinction visible. Everything else the
 * app reports is *derived*: a balance is the opening figure plus every row
 * since, goal progress is read off the ledger, the split is computed from the
 * month summary. A holding's value is none of that. It is a fact from outside,
 * typed in off a statement, correct on the day it was typed and drifting every
 * day after.
 *
 * So nothing here ever returns a value without the date it was true on, and
 * `Wealth` carries the age of the oldest reading it rests on. A number from
 * June printed in August with nothing next to it is a lie, and this app does
 * not print those.
 *
 * What this module deliberately does NOT do — see `docs/INVESTMENTS.md` §1:
 * nothing here reaches income, outflow, net, a bucket total, or the
 * 10/10/10/70 split. Unrealised growth is not income. `summariseMonth` and
 * `prosperitySplit` do not know holdings exist, and a test asserts it stays
 * that way.
 *
 * Pure (§11.6). No Dexie, no fetch, no DOM.
 */

import { daysBetween, type IsoDate } from './datetime';
import { ZERO, add, sub, sum, type Minor } from './money';
import type { Holding, Valuation } from './types';

/** What each kind is called on screen. Liquid only — Q38. */
export const KIND_LABEL: Record<Holding['kind'], string> = {
	cash: 'hotovost',
	savings: 'spoření',
	investment: 'investice',
	crypto: 'krypto'
};

export const HOLDING_KINDS = ['investment', 'savings', 'cash', 'crypto'] as const;

/** The cadence a new holding gets until it is given its own. */
export const DEFAULT_REMINDER_DAYS = 30;

/**
 * A reading past twice its own cadence is not late any more, it is abandoned —
 * and the screen says so in a different colour.
 */
const OVERDUE_FACTOR = 2;

export interface HoldingReading {
	holding: Holding;
	/** The latest live reading, or `null` when the holding has never been valued. */
	latest: Valuation | null;
	/** `latest.value`, or zero. Safe to sum. */
	value: Minor;
	asOf: IsoDate | null;
	/** Days since `asOf`. Null when there has never been a reading. */
	ageDays: number | null;
	/**
	 * Never valued counts as stale: a holding with no number is exactly the
	 * thing the reminder exists to catch, and it is the state every holding
	 * starts in.
	 */
	isStale: boolean;
	isOverdue: boolean;
	/** The reading before `latest` — what the change is measured against. */
	previous: Valuation | null;
	/** `latest - previous`. Null when there is nothing to compare to. */
	change: Minor | null;
	/** The same, as a percentage of the previous reading. */
	changePercent: number | null;
}

export interface Wealth {
	/** From the ledger: opening balance plus every transaction. Derived. */
	cash: Minor;
	/** The sum of the current readings. Stated. */
	invested: Minor;
	total: Minor;
	/**
	 * The date of the oldest reading `invested` rests on, but only when at least
	 * one of them is stale. Null means every number in the total is current
	 * enough to print on its own.
	 */
	restsOn: IsoDate | null;
	staleCount: number;
}

/**
 * The current reading: greatest `date`, ties broken on `createdAt`.
 *
 * The only function allowed to pick. Two readings on one day is not a
 * hypothetical — it is what happens when a number is typed wrong and typed
 * again a minute later, and the second one has to win.
 */
export function currentValuation(valuations: readonly Valuation[]): Valuation | null {
	return liveSorted(valuations)[0] ?? null;
}

/** Newest first. Soft-deleted readings are not readings. */
function liveSorted(valuations: readonly Valuation[]): Valuation[] {
	return valuations
		.filter((v) => !v.isDeleted)
		.sort((a, b) =>
			a.date === b.date ? cmpText(b.createdAt, a.createdAt) : cmpText(b.date, a.date)
		);
}

function cmpText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A signed percentage, which `money.ts`'s `percentOf` deliberately is not.
 *
 * That one answers "what share of the month did this bucket take", and a share
 * is never negative, so it takes the magnitude of both sides. Here the sign is
 * the whole message: a holding that fell has to say it fell. Integer maths on a
 * percentage rather than on money, so the no-floats rule is not in play.
 */
function movePercent(change: Minor, base: Minor): number {
	if (base === 0) return 0;
	return Math.round((change / Math.abs(base)) * 100);
}

export interface ReadHoldingInput {
	holding: Holding;
	/** This holding's readings. Other holdings' rows are ignored if present. */
	valuations: readonly Valuation[];
	today: IsoDate;
}

export function readHolding({ holding, valuations, today }: ReadHoldingInput): HoldingReading {
	const mine = valuations.filter((v) => v.holdingId === holding.id);
	const ordered = liveSorted(mine);
	const latest = ordered[0] ?? null;
	const previous = ordered[1] ?? null;

	const ageDays = latest ? Math.max(0, daysBetween(latest.date, today)) : null;
	const cadence = Math.max(1, holding.reminderDays);

	const change = latest && previous ? sub(latest.value, previous.value) : null;

	return {
		holding,
		latest,
		value: latest?.value ?? ZERO,
		asOf: latest?.date ?? null,
		ageDays,
		isStale: ageDays === null || ageDays > cadence,
		isOverdue: ageDays === null || ageDays > cadence * OVERDUE_FACTOR,
		previous,
		change,
		changePercent:
			change !== null && previous && previous.value !== 0
				? movePercent(change, previous.value)
				: null
	};
}

export interface ReadHoldingsInput {
	holdings: readonly Holding[];
	valuations: readonly Valuation[];
	today: IsoDate;
}

/** Live holdings only, in their configured order. */
export function readHoldings({ holdings, valuations, today }: ReadHoldingsInput): HoldingReading[] {
	return holdings
		.filter((h) => !h.isDeleted && !h.isArchived)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((holding) => readHolding({ holding, valuations, today }));
}

export interface WealthInput {
	/** The ledger balance. Already computed by `balanceOf`. */
	cash: Minor;
	readings: readonly HoldingReading[];
}

/**
 * Cash plus holdings, and nothing is counted twice.
 *
 * The money that bought the ETF left the current account as an outflow months
 * ago, so the ledger balance and the holdings are disjoint by construction —
 * there is no netting to do and no transfer to unwind.
 *
 * Debt is deliberately absent (Q39): `celkem` is a pure assets total in v1. The
 * mortgage-shaped version of this figure is a second feature, and the shape
 * here can hold it when it arrives.
 */
export function wealthTotal({ cash, readings }: WealthInput): Wealth {
	const invested = sum(readings.map((r) => r.value));
	const stale = readings.filter((r) => r.isStale);

	// Only readings that actually contribute a number can make the total stale.
	// A holding that has never been valued contributes zero, and zero is not a
	// figure that can be out of date.
	const datedStale = stale.filter((r) => r.asOf !== null);
	const restsOn = datedStale.reduce<IsoDate | null>(
		(oldest, r) => (oldest === null || r.asOf! < oldest ? r.asOf! : oldest),
		null
	);

	return {
		cash,
		invested,
		total: add(cash, invested),
		restsOn,
		staleCount: stale.length
	};
}

/**
 * The sanity line under the keypad while a new value is being typed.
 *
 * It never blocks — rule 7 — it just refuses to let a fat-fingered zero go in
 * silently. Forty per cent is chosen to sit above a normal month on anything in
 * `HOLDING_KINDS` and below the smallest typo that matters: an extra digit is
 * always +900 %, and a missing one always −90 %.
 */
const UNLIKELY_MOVE_PERCENT = 40;

export function valuationWarning(next: Minor, previous: Valuation | null): string | null {
	if (!previous || previous.value === 0) return null;

	const move = movePercent(sub(next, previous.value), previous.value);
	if (Math.abs(move) <= UNLIKELY_MOVE_PERCENT) return null;

	return move > 0
		? `To je o ${move} % víc než minule. Sedí to?`
		: `To je o ${Math.abs(move)} % míň než minule. Sedí to?`;
}
