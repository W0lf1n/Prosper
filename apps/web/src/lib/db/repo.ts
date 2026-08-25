/**
 * Every write to the database goes through this file.
 *
 * It owns three invariants so no caller has to remember them:
 *   1. `updatedAt` / `deviceId` are stamped on every mutation.
 *   2. Deletes are soft. Nothing calls `.delete()` on user data, ever (§11.2).
 *   3. Mutations pass through `enqueue()`, the seam the P2 outbox plugs into.
 */

import { monthKey, nowIso, startOfMonth, today } from '$lib/domain/datetime';
import { validateGoal, validateGoalShape } from '$lib/domain/goals';
import { DEFAULT_REMINDER_DAYS } from '$lib/domain/holdings';
import { dueSchedules, partitionByMode, type DueItem } from '$lib/domain/recurring';
import { newDeviceId, uuidv7 } from '$lib/domain/ids';
import { ZERO, abs, neg, type Minor } from '$lib/domain/money';
import type {
	Account,
	Category,
	DayMark,
	Goal,
	Holding,
	MonthTarget,
	Schedule,
	SyncedEntity,
	Txn,
	TxnSource,
	Valuation
} from '$lib/domain/types';
import { db } from './schema';
import { seedCategories } from './seed';

/** Flipped on in P2, together with the sync engine. Until then nothing drains. */
const SYNC_ENABLED = false;

const META_DEVICE_ID = 'deviceId';
const META_ACTIVE_ACCOUNT = 'activeAccountId';
const META_LAST_SEEN = 'lastSeenDate';

// ── meta ────────────────────────────────────────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
	const row = await db().meta.get(key);
	return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
	await db().meta.put({ key, value });
}

let deviceIdCache: string | null = null;

/** Stable per browser profile. Created on first run and never changed. */
export async function getDeviceId(): Promise<string> {
	if (deviceIdCache) return deviceIdCache;
	let id = await getMeta<string>(META_DEVICE_ID);
	if (!id) {
		id = newDeviceId();
		await setMeta(META_DEVICE_ID, id);
	}
	deviceIdCache = id;
	return id;
}

export async function getActiveAccountId(): Promise<string | undefined> {
	return getMeta<string>(META_ACTIVE_ACCOUNT);
}

export async function setActiveAccountId(id: string): Promise<void> {
	await setMeta(META_ACTIVE_ACCOUNT, id);
}

// ── outbox seam ─────────────────────────────────────────────────────────────

async function enqueue(entity: SyncedEntity, entityId: string, payload: unknown): Promise<void> {
	if (!SYNC_ENABLED) return;
	await db().outbox.add({
		entity,
		entityId,
		payload,
		queuedAt: nowIso(),
		attempts: 0,
		lastError: null
	});
}

async function stamp(): Promise<{ updatedAt: string; deviceId: string }> {
	return { updatedAt: nowIso(), deviceId: await getDeviceId() };
}

// ── first run ───────────────────────────────────────────────────────────────

export interface SeedResult {
	accountId: string;
	seeded: boolean;
}

/**
 * Make sure there is something to write against: one account and the starter
 * category set. Idempotent — safe to call on every app start.
 */
export async function ensureSeeded(): Promise<SeedResult> {
	const database = db();
	const existing = await getActiveAccountId();
	if (existing && (await database.accounts.get(existing))) {
		return { accountId: existing, seeded: false };
	}

	const accounts = await database.accounts.toArray();
	const live = accounts.filter((a) => !a.isDeleted);
	if (live.length > 0) {
		await setActiveAccountId(live[0]!.id);
		return { accountId: live[0]!.id, seeded: false };
	}

	const { updatedAt, deviceId } = await stamp();
	const account: Account = {
		id: uuidv7(),
		name: 'Běžný účet',
		kind: 'checking',
		openingBalance: ZERO,
		openingDate: today(),
		currency: 'CZK',
		isArchived: false,
		sortOrder: 0,
		updatedAt,
		deviceId,
		isDeleted: false
	};

	const categories: Category[] = seedCategories().map((seed, index) => ({
		id: uuidv7(),
		parentId: null,
		name: seed.name,
		spendType: seed.spendType,
		monthlyCap: null,
		sortOrder: index,
		isArchived: false,
		isIncome: seed.isIncome ?? false,
		updatedAt,
		deviceId,
		isDeleted: false
	}));

	await database.transaction(
		'rw',
		database.accounts,
		database.categories,
		database.meta,
		async () => {
			await database.accounts.put(account);
			if ((await database.categories.count()) === 0) {
				await database.categories.bulkPut(categories);
			}
			await database.meta.put({ key: META_ACTIVE_ACCOUNT, value: account.id });
		}
	);

	return { accountId: account.id, seeded: true };
}

// ── transactions ────────────────────────────────────────────────────────────

export interface NewTxn {
	accountId: string;
	amount: Minor;
	date?: string;
	categoryId?: string | null;
	payee?: string;
	note?: string | null;
	source?: TxnSource;
	isOneOff?: boolean;
	owedAmount?: Minor | null;
	owedBy?: string | null;
	/** Set only by the recurring catch-up. Everything typed by hand leaves it null. */
	scheduleId?: string | null;
}

export async function createTxn(input: NewTxn): Promise<Txn> {
	const { updatedAt, deviceId } = await stamp();
	const txn: Txn = {
		id: uuidv7(),
		accountId: input.accountId,
		date: input.date ?? today(),
		amount: input.amount,
		categoryId: input.categoryId ?? null,
		payee: input.payee?.trim() ?? '',
		note: input.note?.trim() || null,
		transferPairId: null,
		source: input.source ?? 'manual',
		isCleared: false,
		isOneOff: input.isOneOff ?? false,
		owedAmount: input.owedAmount ?? null,
		owedBy: input.owedBy?.trim() || null,
		settledByTxnId: null,
		scheduleId: input.scheduleId ?? null,
		createdAt: updatedAt,
		updatedAt,
		deviceId,
		isDeleted: false
	};

	await db().txns.put(txn);
	// Recording a transaction is itself proof the day was not a blank.
	await db().dayMarks.delete(txn.date);
	await enqueue('txn', txn.id, txn);
	return txn;
}

export type TxnPatch = Partial<
	Pick<
		Txn,
		| 'amount'
		| 'date'
		| 'categoryId'
		| 'payee'
		| 'note'
		| 'isCleared'
		| 'isOneOff'
		| 'owedAmount'
		| 'owedBy'
	>
>;

export async function updateTxn(id: string, patch: TxnPatch): Promise<Txn | undefined> {
	const database = db();
	const existing = await database.txns.get(id);
	if (!existing) return undefined;

	const next: Txn = { ...existing, ...patch, ...(await stamp()) };
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
	return next;
}

/** Soft delete. The row stays, flagged, forever. */
export async function deleteTxn(id: string): Promise<void> {
	const database = db();
	const existing = await database.txns.get(id);
	if (!existing || existing.isDeleted) return;

	const next: Txn = { ...existing, isDeleted: true, ...(await stamp()) };
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
}

/**
 * Undo of a local delete, for the toast.
 *
 * Note this is a *local* undo only. Once sync lands, a delete that has already
 * been pushed must never be reversed by a merge (§4) — that rule governs the
 * sync engine, not the person who just mis-tapped.
 */
export async function restoreTxn(id: string): Promise<void> {
	const database = db();
	const existing = await database.txns.get(id);
	if (!existing || !existing.isDeleted) return;

	const next: Txn = { ...existing, isDeleted: false, ...(await stamp()) };
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
}

// ── receivables ─────────────────────────────────────────────────────────────

/**
 * Somebody paid you back.
 *
 * Creates the inflow that carries the money and links it to the expense it came
 * from. Until this runs, the outstanding amount is not in the balance and not in
 * any total — you paid the whole thing, because you did.
 */
export async function settleReceivable(txnId: string, date?: string): Promise<Txn | undefined> {
	const database = db();
	const original = await database.txns.get(txnId);
	if (!original || original.isDeleted) return undefined;
	if (!original.owedAmount || original.settledByTxnId) return undefined;

	const repayment = await createTxn({
		accountId: original.accountId,
		amount: original.owedAmount,
		date: date ?? today(),
		categoryId: original.categoryId,
		payee: original.owedBy ? `vrácení — ${original.owedBy}` : 'vrácení',
		note: `k výdaji „${original.payee || 'bez popisu'}"`
	});

	const next: Txn = { ...original, settledByTxnId: repayment.id, ...(await stamp()) };
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
	return repayment;
}

/** Undo of the above: removes the inflow and reopens the receivable. */
export async function unsettleReceivable(txnId: string): Promise<void> {
	const database = db();
	const original = await database.txns.get(txnId);
	if (!original?.settledByTxnId) return;

	await deleteTxn(original.settledByTxnId);
	const next: Txn = { ...original, settledByTxnId: null, ...(await stamp()) };
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
}

// ── accounts ────────────────────────────────────────────────────────────────

export async function updateAccount(
	id: string,
	patch: Partial<Pick<Account, 'name' | 'kind' | 'openingBalance' | 'openingDate' | 'isArchived'>>
): Promise<void> {
	const database = db();
	const existing = await database.accounts.get(id);
	if (!existing) return;

	const next: Account = { ...existing, ...patch, ...(await stamp()) };
	await database.accounts.put(next);
	await enqueue('account', next.id, next);
}

export async function createAccount(
	input: Pick<Account, 'name' | 'kind'> & Partial<Pick<Account, 'openingBalance' | 'openingDate'>>
): Promise<Account> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const account: Account = {
		id: uuidv7(),
		name: input.name.trim(),
		kind: input.kind,
		openingBalance: input.openingBalance ?? ZERO,
		openingDate: input.openingDate ?? today(),
		currency: 'CZK',
		isArchived: false,
		sortOrder: await database.accounts.count(),
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await database.accounts.put(account);
	await enqueue('account', account.id, account);
	return account;
}

// ── categories ──────────────────────────────────────────────────────────────

export async function createCategory(
	input: Pick<Category, 'name' | 'spendType'> &
		Partial<Pick<Category, 'parentId' | 'monthlyCap' | 'isIncome'>>
): Promise<Category> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const category: Category = {
		id: uuidv7(),
		parentId: input.parentId ?? null,
		name: input.name.trim(),
		spendType: input.spendType,
		monthlyCap: input.monthlyCap ?? null,
		sortOrder: await database.categories.count(),
		isArchived: false,
		isIncome: input.isIncome ?? false,
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await database.categories.put(category);
	await enqueue('category', category.id, category);
	return category;
}

export async function updateCategory(
	id: string,
	patch: Partial<
		Pick<Category, 'name' | 'spendType' | 'monthlyCap' | 'sortOrder' | 'isArchived' | 'isIncome'>
	>
): Promise<void> {
	const database = db();
	const existing = await database.categories.get(id);
	if (!existing) return;

	const next: Category = { ...existing, ...patch, ...(await stamp()) };
	await database.categories.put(next);
	await enqueue('category', next.id, next);
}

/**
 * Categories are archived, never deleted, while transactions still point at
 * them (§4). Archiving hides the chip; the history stays readable.
 */
export async function archiveCategory(id: string): Promise<void> {
	await updateCategory(id, { isArchived: true });
}

// ── recurring payments ───────────────────────────────────────────

export async function createSchedule(
	input: Pick<Schedule, 'payee' | 'categoryId' | 'amount' | 'dayOfMonth'> &
		Partial<Pick<Schedule, 'startMonth' | 'endMonth' | 'mode'>>
): Promise<Schedule> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const schedule: Schedule = {
		id: uuidv7(),
		payee: input.payee.trim(),
		categoryId: input.categoryId,
		amount: input.amount,
		dayOfMonth: Math.min(31, Math.max(1, Math.trunc(input.dayOfMonth))),
		startMonth: input.startMonth ?? monthKey(today()),
		endMonth: input.endMonth ?? null,
		mode: input.mode ?? 'confirm',
		/**
		 * Written as settled for the month before it starts, so a schedule added
		 * on the 20th for a payment that went out on the 5th does not immediately
		 * claim to owe that month. Backfilling the current month is a decision,
		 * and it is made by typing the row.
		 */
		lastPostedMonth: null,
		isArchived: false,
		sortOrder: await database.schedules.count(),
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await database.schedules.put(schedule);
	await enqueue('schedule', schedule.id, schedule);
	return schedule;
}

export async function updateSchedule(
	id: string,
	patch: Partial<
		Pick<
			Schedule,
			| 'payee'
			| 'categoryId'
			| 'amount'
			| 'dayOfMonth'
			| 'startMonth'
			| 'endMonth'
			| 'mode'
			| 'lastPostedMonth'
			| 'sortOrder'
			| 'isArchived'
		>
	>
): Promise<void> {
	const database = db();
	const existing = await database.schedules.get(id);
	if (!existing) return;

	const next: Schedule = { ...existing, ...patch, ...(await stamp()) };
	await database.schedules.put(next);
	await enqueue('schedule', next.id, next);
}

export async function archiveSchedule(id: string): Promise<void> {
	await updateSchedule(id, { isArchived: true });
}

/** The watermark only ever moves forward. */
async function settle(schedule: Schedule, month: string): Promise<void> {
	if (schedule.lastPostedMonth && schedule.lastPostedMonth >= month) return;
	await updateSchedule(schedule.id, { lastPostedMonth: month });
}

/**
 * Turn one due instance into a real row.
 *
 * `amount` overrides the schedule's own figure without changing it — the gas
 * bill is 2 800 Kč most months and 4 100 Kč in February, and correcting one
 * month must not silently rewrite the standing order.
 */
export async function confirmScheduled(
	item: DueItem,
	options: { accountId: string; amount?: Minor }
): Promise<Txn> {
	const txn = await createTxn({
		accountId: options.accountId,
		amount: options.amount ?? item.schedule.amount,
		date: item.date,
		categoryId: item.schedule.categoryId,
		payee: item.schedule.payee,
		source: 'recurring',
		scheduleId: item.schedule.id
	});
	await settle(item.schedule, item.month);
	return txn;
}

/**
 * "Not this month." A holiday from a subscription, or a row already typed by
 * hand — both are the same fact to the next launch, and neither should leave
 * the app asking again tomorrow.
 */
export async function skipScheduled(item: DueItem): Promise<void> {
	await settle(item.schedule, item.month);
}

export interface CatchUpResult {
	/** Rows written without being asked. */
	posted: number;
	/** Instances now waiting to be confirmed. */
	waiting: number;
}

/**
 * The launch catch-up.
 *
 * Nothing happens while the app is closed — there is no server — so the
 * standing orders are settled on the way in, exactly as `closePreviousDay`
 * closes off yesterday. Only `auto` schedules write anything; `confirm` ones are
 * counted and shown.
 */
export async function catchUpSchedules(accountId: string | null): Promise<CatchUpResult> {
	if (!accountId) return { posted: 0, waiting: 0 };

	const schedules = await db().schedules.toArray();
	const items = dueSchedules({ schedules, today: today() });
	const { auto, confirm } = partitionByMode(items);

	for (const item of auto) {
		await confirmScheduled(item, { accountId });
	}

	return { posted: auto.length, waiting: confirm.length };
}

// ── holdings ─────────────────────────────────────────────────────

export async function createHolding(
	input: Pick<Holding, 'name' | 'kind'> & Partial<Pick<Holding, 'categoryId' | 'reminderDays'>>
): Promise<Holding> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const holding: Holding = {
		id: uuidv7(),
		name: input.name.trim(),
		kind: input.kind,
		currency: 'CZK',
		categoryId: input.categoryId ?? null,
		reminderDays: input.reminderDays ?? DEFAULT_REMINDER_DAYS,
		isArchived: false,
		sortOrder: await database.holdings.count(),
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await database.holdings.put(holding);
	await enqueue('holding', holding.id, holding);
	return holding;
}

export async function updateHolding(
	id: string,
	patch: Partial<
		Pick<Holding, 'name' | 'kind' | 'categoryId' | 'reminderDays' | 'sortOrder' | 'isArchived'>
	>
): Promise<void> {
	const database = db();
	const existing = await database.holdings.get(id);
	if (!existing) return;

	const next: Holding = { ...existing, ...patch, ...(await stamp()) };
	await database.holdings.put(next);
	await enqueue('holding', next.id, next);
}

/**
 * Archived, never deleted, for the same reason categories are: the readings
 * point at it, and a value with nothing to belong to is worse than a row that
 * has stopped appearing on the screen.
 */
export async function archiveHolding(id: string): Promise<void> {
	await updateHolding(id, { isArchived: true });
}

/**
 * A reading. `date` is the day the number was *true* — a statement opened on
 * the 14th for the 3rd is filed on the 3rd, or the age the reminder runs on is
 * wrong by eleven days.
 */
export async function recordValuation(input: {
	holdingId: string;
	value: Minor;
	date?: string;
	note?: string | null;
}): Promise<Valuation> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const valuation: Valuation = {
		id: uuidv7(),
		holdingId: input.holdingId,
		date: input.date ?? today(),
		value: abs(input.value),
		note: input.note?.trim() || null,
		createdAt: nowIso(),
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await database.valuations.put(valuation);
	await enqueue('valuation', valuation.id, valuation);
	return valuation;
}

/** Soft, like everything else. The reading before it becomes current again. */
export async function deleteValuation(id: string): Promise<void> {
	const database = db();
	const existing = await database.valuations.get(id);
	if (!existing) return;

	const next: Valuation = { ...existing, isDeleted: true, ...(await stamp()) };
	await database.valuations.put(next);
	await enqueue('valuation', next.id, next);
}

// ── day marks ───────────────────────────────────────────────────────────────

/** "I spent nothing today" — the explicit alternative to a gap. */
export async function markZeroSpendDay(date: string): Promise<void> {
	const mark: DayMark = { date, deviceId: await getDeviceId(), updatedAt: nowIso() };
	await db().dayMarks.put(mark);
	await enqueue('dayMark', date, mark);
}

export async function clearZeroSpendDay(date: string): Promise<void> {
	await db().dayMarks.delete(date);
}

/**
 * Close off the previous day, automatically.
 *
 * The rule, decided 2026-08-24: **a day is marked zero-spend only if the app was
 * actually open on it and nothing was recorded.** That is a real signal — you
 * had the thing in your hand and there was nothing to put in it. A day you never
 * opened the app is not a zero, it is a day you did not look, and it stays a
 * visible hole in the tape (§2.1).
 *
 * So this marks exactly one date: the last day the app was seen, once that day
 * is over. It never reaches backwards past the first run, which is why the
 * history he already has keeps its honest gaps and `coverage` keeps working.
 */
export async function closePreviousDay(): Promise<string | null> {
	const database = db();
	const now = today();
	const lastSeen = await getMeta<string>(META_LAST_SEEN);
	await setMeta(META_LAST_SEEN, now);

	// First run ever: nothing to close, and nothing historical to invent.
	if (!lastSeen || lastSeen >= now) return null;

	if (await database.dayMarks.get(lastSeen)) return null;

	const rows = await database.txns.where('date').equals(lastSeen).toArray();
	if (rows.some((t) => !t.isDeleted)) return null;

	await markZeroSpendDay(lastSeen);
	return lastSeen;
}

// ── goals — the Targeting law (§2.2) ─────────────────────────────────────────

export async function createGoal(
	input: Pick<Goal, 'name' | 'why' | 'targetAmount' | 'targetDate'> &
		Partial<Pick<Goal, 'linkedAccountId' | 'categoryId' | 'startDate'>>
): Promise<Goal> {
	// The refusal is the mechanism, not a validation nicety. It lives in the
	// domain layer so the form and the database agree on what a goal is.
	const problems = validateGoal({
		name: input.name,
		why: input.why,
		targetAmount: abs(input.targetAmount),
		targetDate: input.targetDate
	});
	if (problems.length > 0) {
		throw new Error('Cíl bez důvodu, částky a termínu je jen přání.');
	}

	const { updatedAt, deviceId } = await stamp();
	const goal: Goal = {
		id: uuidv7(),
		name: input.name.trim(),
		why: input.why.trim(),
		targetAmount: abs(input.targetAmount),
		targetDate: input.targetDate,
		linkedAccountId: input.linkedAccountId ?? null,
		categoryId: input.categoryId ?? null,
		// A goal starts counting the month it was written, not from whatever
		// happened to be in the savings bucket beforehand.
		startDate: input.startDate ?? startOfMonth(today()),
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await db().goals.put(goal);
	await enqueue('goal', goal.id, goal);
	return goal;
}

export type GoalPatch = Partial<
	Pick<Goal, 'name' | 'why' | 'targetAmount' | 'targetDate' | 'categoryId' | 'startDate'>
>;

export async function updateGoal(id: string, patch: GoalPatch): Promise<Goal | undefined> {
	const database = db();
	const existing = await database.goals.get(id);
	if (!existing) return undefined;

	const next: Goal = { ...existing, ...patch, ...(await stamp()) };
	// The deadline is deliberately not re-checked: moving a date that has already
	// passed is one of the reasons to be editing a goal at all.
	if (validateGoalShape(next).length > 0) {
		throw new Error('Cíl potřebuje jméno, důvod a částku.');
	}

	await database.goals.put(next);
	await enqueue('goal', next.id, next);
	return next;
}

/** Soft delete, like everything else (§13.2). The months it ran stay readable. */
export async function deleteGoal(id: string): Promise<void> {
	const database = db();
	const existing = await database.goals.get(id);
	if (!existing || existing.isDeleted) return;

	const next: Goal = { ...existing, isDeleted: true, ...(await stamp()) };
	await database.goals.put(next);
	await enqueue('goal', next.id, next);
}

// ── month targets — the number he actually said yes to ───────────────────────

/**
 * Write down what this month is aiming at.
 *
 * One row per goal per month, replaced in place. The app can always compute a
 * suggestion; this records the decision, and the difference between the two is
 * what the law is about.
 */
export async function setMonthTarget(
	goalId: string,
	month: string,
	amount: Minor
): Promise<MonthTarget> {
	const database = db();
	const existing = await database.monthTargets.where({ goalId, month }).first();
	const { updatedAt, deviceId } = await stamp();

	const target: MonthTarget = {
		id: existing?.id ?? uuidv7(),
		goalId,
		month,
		amount: abs(amount),
		updatedAt,
		deviceId,
		isDeleted: false
	};

	await database.monthTargets.put(target);
	await enqueue('monthTarget', target.id, target);
	return target;
}

/** Take the commitment back. The month falls back to the computed suggestion. */
export async function clearMonthTarget(goalId: string, month: string): Promise<void> {
	const database = db();
	const existing = await database.monthTargets.where({ goalId, month }).first();
	if (!existing || existing.isDeleted) return;

	const next: MonthTarget = { ...existing, isDeleted: true, ...(await stamp()) };
	await database.monthTargets.put(next);
	await enqueue('monthTarget', next.id, next);
}

/**
 * Put money aside, from the goal screen, in one tap.
 *
 * It is an ordinary outflow into the goal's bucket — there is no second ledger
 * for savings, which is the only reason progress can be trusted at all.
 */
export async function contributeToGoal(input: {
	goal: Goal;
	accountId: string;
	amount: Minor;
	categoryId: string;
	date?: string;
}): Promise<Txn> {
	return createTxn({
		accountId: input.accountId,
		amount: neg(abs(input.amount)),
		date: input.date ?? today(),
		categoryId: input.categoryId,
		payee: input.goal.name,
		note: `cíl — ${monthKey(input.date ?? today())}`
	});
}

// ── backup ──────────────────────────────────────────────────────────────────

export interface Backup {
	format: 'finance-backup';
	version: number;
	exportedAt: string;
	accounts: Account[];
	categories: Category[];
	txns: Txn[];
	dayMarks: DayMark[];
	goals: Goal[];
	monthTargets: MonthTarget[];
	holdings: Holding[];
	valuations: Valuation[];
	schedules: Schedule[];
}

/**
 * Until sync exists, this file is the only copy of the ledger that survives a
 * cleared browser profile. Settings nags about it for a reason.
 */
export async function exportBackup(): Promise<Backup> {
	const database = db();
	return {
		format: 'finance-backup',
		version: 4,
		exportedAt: nowIso(),
		accounts: await database.accounts.toArray(),
		categories: await database.categories.toArray(),
		txns: await database.txns.toArray(),
		dayMarks: await database.dayMarks.toArray(),
		goals: await database.goals.toArray(),
		monthTargets: await database.monthTargets.toArray(),
		holdings: await database.holdings.toArray(),
		valuations: await database.valuations.toArray(),
		schedules: await database.schedules.toArray()
	};
}

export interface ImportResult {
	accounts: number;
	categories: number;
	txns: number;
}

/** Merge a backup in. Same last-write-wins rule the sync layer will use. */
export async function importBackup(backup: Backup): Promise<ImportResult> {
	if (backup?.format !== 'finance-backup') {
		throw new Error('Tohle není záloha téhle aplikace.');
	}
	const database = db();

	// Nine tables: past five, Dexie wants the array form rather than varargs.
	await database.transaction(
		'rw',
		[
			database.accounts,
			database.categories,
			database.txns,
			database.dayMarks,
			database.goals,
			database.monthTargets,
			database.holdings,
			database.valuations,
			database.schedules
		],
		async () => {
			await mergeRows(
				backup.accounts ?? [],
				(id) => database.accounts.get(id),
				(row) => database.accounts.put(row)
			);
			await mergeRows(
				backup.categories ?? [],
				(id) => database.categories.get(id),
				(row) => database.categories.put(row)
			);
			await mergeRows(
				backup.txns ?? [],
				(id) => database.txns.get(id),
				(row) => database.txns.put(row)
			);
			await mergeRows(
				backup.goals ?? [],
				(id) => database.goals.get(id),
				(row) => database.goals.put(row)
			);
			await mergeRows(
				backup.monthTargets ?? [],
				(id) => database.monthTargets.get(id),
				(row) => database.monthTargets.put(row)
			);
			await mergeRows(
				backup.holdings ?? [],
				(id) => database.holdings.get(id),
				(row) => database.holdings.put(row)
			);
			await mergeRows(
				backup.valuations ?? [],
				(id) => database.valuations.get(id),
				(row) => database.valuations.put(row)
			);
			await mergeRows(
				backup.schedules ?? [],
				(id) => database.schedules.get(id),
				(row) => database.schedules.put(row)
			);
			for (const mark of backup.dayMarks ?? []) await database.dayMarks.put(mark);
		}
	);

	return {
		accounts: backup.accounts?.length ?? 0,
		categories: backup.categories?.length ?? 0,
		txns: backup.txns?.length ?? 0
	};
}

interface Versioned {
	id: string;
	updatedAt: string;
	deviceId: string;
	isDeleted: boolean;
}

/** Last-write-wins on updatedAt, tiebreak on deviceId — the §5.3 rule. */
async function mergeRows<T extends Versioned>(
	rows: T[],
	read: (id: string) => Promise<T | undefined>,
	write: (row: T) => Promise<unknown>
): Promise<void> {
	for (const incoming of rows) {
		const existing = await read(incoming.id);
		if (!existing) {
			await write(incoming);
			continue;
		}
		const wins =
			incoming.updatedAt > existing.updatedAt ||
			(incoming.updatedAt === existing.updatedAt && incoming.deviceId > existing.deviceId);
		// A delete is never undone by a merge (§4).
		if (wins) await write({ ...incoming, isDeleted: incoming.isDeleted || existing.isDeleted });
	}
}
