/**
 * What a row has to look like before it may be written.
 *
 * Every write made *in* the app goes through `repo.ts`, and TypeScript has
 * already said what a `Txn` is by the time the keypad produces one. Two doors
 * skip that: a backup being restored, and a page arriving from the sync
 * server. Both used to trust the file. One transaction carrying
 * `amount: -1000.5` — or `"abc"` — made `money.ts` throw inside every live
 * query, and every screen showed a ledger of zeros under a sync card that said
 * all was well (DECISIONS, the 2026-09-05 audit).
 *
 * This is the guard at both doors. It checks only what the domain computes
 * with: the four sync fields, every amount, every date, the arrays the
 * accessors walk, and the type of every field a screen branches on. It does
 * **not** check enum membership and it does not reject fields it has never
 * heard of — a row written by a newer build is still a row. The older shapes
 * pass too: the accessors in `accounts.ts`, `receivables.ts` and
 * `recurring.ts` already read a missing `pockets`, a missing `shares` and
 * the legacy `owedAmount` pair, so a v1 backup restores exactly as it did.
 *
 * Pure (§13.6). The reason is English, for the console; the count is what the
 * screen gets.
 */

import type { SyncedEntity } from './types';

/** A field check: the problem, or null when the value is fine. */
type Check = (value: unknown) => string | null;

type Shape = Record<string, Check>;

const string: Check = (v) => (typeof v === 'string' ? null : 'not a string');

const nonEmpty: Check = (v) =>
	typeof v === 'string' && v.length > 0 ? null : 'missing or not a string';

const bool: Check = (v) => (typeof v === 'boolean' ? null : 'not a boolean');

const number: Check = (v) =>
	typeof v === 'number' && Number.isFinite(v) ? null : 'not a finite number';

/** An amount: a whole number of minor units — the same line `money.ts` draws. */
const money: Check = (v) =>
	typeof v === 'number' && Number.isSafeInteger(v) ? null : 'not a whole number of minor units';

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM-DD`, and a day that exists — the 31st of February is not a date. */
const isoDate: Check = (v) => {
	if (typeof v !== 'string') return 'not a date';
	const match = DATE.exec(v);
	if (!match) return 'not a YYYY-MM-DD date';
	const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(y, m - 1, d));
	const real =
		date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
	return real ? null : 'not a calendar date';
};

const isoMonth: Check = (v) =>
	typeof v === 'string' && MONTH.test(v) ? null : 'not a YYYY-MM month';

const dayOfMonth: Check = (v) =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31 ? null : 'not a day 1–31';

const nullable =
	(check: Check): Check =>
	(v) =>
		v === null ? null : check(v);

/** Absent is fine; present has to be right. For every field a later schema added. */
const optional =
	(check: Check): Check =>
	(v) =>
		v === undefined ? null : check(v);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkShape(value: unknown, shape: Shape): string | null {
	if (!isRecord(value)) return 'not an object';
	for (const [field, check] of Object.entries(shape)) {
		const problem = check(value[field]);
		if (problem) return `${field}: ${problem}`;
	}
	return null;
}

const listOf =
	(shape: Shape): Check =>
	(v) => {
		if (!Array.isArray(v)) return 'not a list';
		for (let i = 0; i < v.length; i += 1) {
			const problem = checkShape(v[i], shape);
			if (problem) return `[${i}].${problem}`;
		}
		return null;
	};

// ── the shapes ──────────────────────────────────────────────────────────────

/** The four fields every synced row carries (`types.ts` → `Synced`, plus `id`). */
const SYNCED: Shape = {
	id: nonEmpty,
	updatedAt: nonEmpty,
	deviceId: string,
	isDeleted: bool
};

/** The v9 trio, still on rows older backups carry — read by `sharesOf()`. */
const LEGACY_OWED: Shape = {
	owedAmount: optional(nullable(money)),
	owedBy: optional(nullable(string))
};

const TXN_SHARE: Shape = {
	id: string,
	who: string,
	amount: money,
	settledByTxnId: optional(nullable(string))
};

const SCHEDULE_SHARE: Shape = { id: string, who: string, amount: money };

const POCKET: Shape = { id: string, name: string, amount: money };

const SHAPES: Record<SyncedEntity, Shape> = {
	txn: {
		...SYNCED,
		accountId: nonEmpty,
		date: isoDate,
		amount: money,
		categoryId: nullable(string),
		payee: string,
		note: optional(nullable(string)),
		transferPairId: optional(nullable(string)),
		source: optional(string),
		isCleared: optional(bool),
		createdAt: optional(string),
		isOneOff: optional(bool),
		shares: optional(listOf(TXN_SHARE)),
		scheduleId: optional(nullable(string)),
		...LEGACY_OWED,
		settledByTxnId: optional(nullable(string))
	},
	account: {
		...SYNCED,
		name: string,
		kind: string,
		openingBalance: money,
		openingDate: isoDate,
		pockets: optional(listOf(POCKET)),
		currency: nonEmpty,
		isArchived: optional(bool),
		sortOrder: optional(number)
	},
	category: {
		...SYNCED,
		parentId: optional(nullable(string)),
		name: string,
		spendType: nonEmpty,
		monthlyCap: optional(nullable(money)),
		sortOrder: optional(number),
		isArchived: optional(bool),
		isIncome: optional(bool),
		icon: optional(string),
		color: optional(string)
	},
	goal: {
		...SYNCED,
		name: string,
		why: string,
		targetAmount: money,
		targetDate: isoDate,
		linkedAccountId: optional(nullable(string)),
		categoryId: optional(nullable(string)),
		startDate: optional(isoDate),
		startAmount: optional(money),
		isPinned: optional(bool)
	},
	monthTarget: {
		...SYNCED,
		goalId: nonEmpty,
		month: isoMonth,
		amount: money
	},
	holding: {
		...SYNCED,
		name: string,
		kind: string,
		currency: optional(string),
		categoryId: optional(nullable(string)),
		startDate: optional(isoDate),
		reminderDays: optional(number),
		isArchived: optional(bool),
		sortOrder: optional(number)
	},
	valuation: {
		...SYNCED,
		holdingId: nonEmpty,
		date: isoDate,
		value: money,
		note: optional(nullable(string)),
		createdAt: optional(string)
	},
	schedule: {
		...SYNCED,
		accountId: optional(string),
		payee: string,
		categoryId: nonEmpty,
		amount: money,
		dayOfMonth,
		startMonth: isoMonth,
		endMonth: optional(nullable(isoMonth)),
		mode: optional(string),
		shares: optional(listOf(SCHEDULE_SHARE)),
		lastPostedMonth: optional(nullable(isoMonth)),
		isArchived: optional(bool),
		sortOrder: optional(number),
		...LEGACY_OWED
	},
	reconciliation: {
		...SYNCED,
		accountId: nonEmpty,
		date: isoDate,
		statementBalance: money,
		computedBalance: money,
		adjustmentTxnId: optional(nullable(string))
	},
	// Keyed by its date, and carries no `id` or `isDeleted` — the one row shape
	// that is not `Synced`.
	dayMark: {
		date: isoDate,
		deviceId: string,
		updatedAt: nonEmpty
	}
};

/**
 * Why `row` may not be written as an `entity`, or null when it may.
 *
 * The reason names the field, so a console line reads
 * `txn: amount: not a whole number of minor units` and somebody looking at a
 * backup knows which column to look at.
 */
export function checkRow(entity: SyncedEntity, row: unknown): string | null {
	const shape = Object.hasOwn(SHAPES, entity) ? SHAPES[entity] : undefined;
	if (!shape) return `unknown entity "${String(entity)}"`;
	return checkShape(row, shape);
}
