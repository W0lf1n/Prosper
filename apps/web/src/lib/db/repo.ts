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
import { ADJUSTMENT_PAYEE, reconcileDelta } from '$lib/domain/reconcile';
import { ZERO, abs, neg, type Minor } from '$lib/domain/money';
import type {
	Account,
	Category,
	DayMark,
	Goal,
	Holding,
	MonthTarget,
	Reconciliation,
	Schedule,
	SyncedEntity,
	Txn,
	TxnSource,
	Valuation
} from '$lib/domain/types';
import { normalize } from '$lib/domain/vocabulary';
import { db } from './schema';
import { seedCategories } from './seed';

const META_DEVICE_ID = 'deviceId';
const META_ACTIVE_ACCOUNT = 'activeAccountId';
const META_SYNC_BASE_URL = 'syncBaseUrl';
const META_ADOPTED = 'ledgerAdopted';

/**
 * Whether mutations are queued for the server.
 *
 * Was a `const false` until P2 existed. It is now "has this device ever been
 * paired", cached because `enqueue` is on the path of every single write and a
 * meta read per mutation would be a database round trip for a question whose
 * answer changes twice in the app's life.
 *
 * `null` means not yet asked. `refreshSyncEnabled()` is called by the sync
 * layer whenever pairing changes.
 */
let syncEnabled: boolean | null = null;

export async function refreshSyncEnabled(): Promise<boolean> {
	syncEnabled = (await getMeta<string>(META_SYNC_BASE_URL)) != null;
	return syncEnabled;
}

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

/**
 * Told when something lands in the outbox, so the sync layer can schedule a
 * cycle — the "after a write, debounced" trigger of §10.7.
 *
 * A callback rather than an import, because `repo.ts` importing the sync status
 * module would close the loop `repo → status → engine → repo`. The sync layer
 * knows about the database; the database does not know about sync.
 */
let outboxListener: (() => void) | null = null;

export function setOutboxListener(listener: (() => void) | null): void {
	outboxListener = listener;
}

async function enqueue(entity: SyncedEntity, entityId: string, payload: unknown): Promise<void> {
	if (syncEnabled === null) await refreshSyncEnabled();
	if (!syncEnabled) return;
	await db().outbox.add({
		entity,
		entityId,
		payload,
		queuedAt: nowIso(),
		attempts: 0,
		lastError: null
	});
	outboxListener?.();
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
		note: `k výdaji „${original.payee || 'bez popisu'}“`
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
		Partial<Pick<Schedule, 'startMonth' | 'endMonth' | 'mode' | 'owedAmount' | 'owedBy'>>
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
		/* The share that comes back, if the payment is shared. Clamped to a
		   positive magnitude here rather than at the form, because the sheet is
		   not the only thing that will ever call this. */
		owedAmount: input.owedAmount ? abs(input.owedAmount) : null,
		owedBy: input.owedBy?.trim() || null,
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
			| 'owedAmount'
			| 'owedBy'
			| 'lastPostedMonth'
			| 'sortOrder'
			| 'isArchived'
		>
	>
): Promise<void> {
	const database = db();
	const existing = await database.schedules.get(id);
	if (!existing) return;

	const next: Schedule = {
		...existing,
		...patch,
		/* Same normalisation as `createSchedule`: a positive magnitude, and zero
		   means nothing comes back rather than "a share of nothing". */
		...(patch.owedAmount === undefined
			? {}
			: { owedAmount: patch.owedAmount ? abs(patch.owedAmount) : null }),
		...(patch.owedBy === undefined ? {} : { owedBy: patch.owedBy?.trim() || null }),
		...(await stamp())
	};
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
	const amount = options.amount ?? item.schedule.amount;
	const txn = await createTxn({
		accountId: options.accountId,
		amount,
		date: item.date,
		categoryId: item.schedule.categoryId,
		payee: item.schedule.payee,
		source: 'recurring',
		scheduleId: item.schedule.id,
		/**
		 * The declared share rides onto the row, so a shared mortgage produces an
		 * open receivable every month without anybody retyping who owes what
		 * (Q46). Only on an outflow, and never more than the row itself — an
		 * overridden amount smaller than the share would otherwise book back more
		 * than went out.
		 */
		owedAmount:
			amount < 0 && item.schedule.owedAmount
				? (Math.min(abs(item.schedule.owedAmount), abs(amount)) as Minor)
				: null,
		owedBy: amount < 0 ? item.schedule.owedBy : null
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
	input: Pick<Holding, 'name' | 'kind'> &
		Partial<Pick<Holding, 'categoryId' | 'reminderDays' | 'startDate'>>
): Promise<Holding> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const holding: Holding = {
		id: uuidv7(),
		name: input.name.trim(),
		kind: input.kind,
		currency: 'CZK',
		categoryId: input.categoryId ?? null,
		// The first of the month it was written — the same rule as `Goal.startDate`
		// (Q27), so a new holding never opens already funded by an existing pot.
		startDate: input.startDate ?? startOfMonth(today()),
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
		Pick<
			Holding,
			'name' | 'kind' | 'categoryId' | 'reminderDays' | 'startDate' | 'sortOrder' | 'isArchived'
		>
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

// ── reconciliation ──────────────────────────────────────────────────────────

export interface ReconcileInput {
	accountId: string;
	/** What the bank says. Positive or negative, as the statement reads. */
	statementBalance: Minor;
	/** What the ledger says at that moment — captured by the caller, before this. */
	computedBalance: Minor;
	date?: string;
	/**
	 * Write a row to close the gap. False records the disagreement and leaves the
	 * ledger alone, which is the right answer when the difference is a payment
	 * that has not cleared yet.
	 */
	adjust: boolean;
	/** Where the adjustment lands. Required when `adjust` is true. */
	categoryId?: string | null;
}

export interface ReconcileResult {
	reconciliation: Reconciliation;
	adjustment: Txn | null;
}

/**
 * Check the ledger against a statement, and optionally record what is missing.
 *
 * **A delta is not an error, it is a missing transaction.** The bank is right
 * about the balance and the ledger is right about the reasons, so the fix is to
 * write the difference in as an ordinary row rather than to overwrite the
 * balance — which would hide the very gap this exercise exists to find.
 *
 * The adjustment is **one-off by construction**: a correction is not the running
 * cost of a month, and letting it into the average would damage the number this
 * is meant to protect.
 *
 * `computedBalance` is passed in rather than derived here. It has to be captured
 * *before* the adjustment is written — a balance read afterwards includes the
 * row that was just added, and the reconciliation would record a delta of zero
 * against a figure that never existed.
 */
export async function reconcileAccount(input: ReconcileInput): Promise<ReconcileResult> {
	const database = db();
	const date = input.date ?? today();
	const delta = reconcileDelta({
		computed: input.computedBalance,
		statement: input.statementBalance
	});

	let adjustment: Txn | null = null;
	if (input.adjust && delta.adjustment !== ZERO) {
		adjustment = await createTxn({
			accountId: input.accountId,
			amount: delta.adjustment,
			date,
			categoryId: input.categoryId ?? null,
			payee: ADJUSTMENT_PAYEE,
			source: 'adjustment',
			isOneOff: true
		});
	}

	const { updatedAt, deviceId } = await stamp();
	const reconciliation: Reconciliation = {
		id: uuidv7(),
		accountId: input.accountId,
		date,
		statementBalance: input.statementBalance,
		computedBalance: input.computedBalance,
		adjustmentTxnId: adjustment?.id ?? null,
		updatedAt,
		deviceId,
		isDeleted: false
	};

	await database.reconciliations.put(reconciliation);
	await enqueue('reconciliation', reconciliation.id, reconciliation);

	return { reconciliation, adjustment };
}

/** Soft, like everything else. The adjustment row is left alone — it is real. */
export async function deleteReconciliation(id: string): Promise<void> {
	const database = db();
	const existing = await database.reconciliations.get(id);
	if (!existing || existing.isDeleted) return;

	const next: Reconciliation = { ...existing, isDeleted: true, ...(await stamp()) };
	await database.reconciliations.put(next);
	await enqueue('reconciliation', next.id, next);
}

// ── day marks ───────────────────────────────────────────────────────────────
//
// There is nothing here any more, and the emptiness is the decision.
//
// Until 2026-08-28 this section wrote `DayMark` rows: "I spent nothing today",
// tapped by hand in the tape, plus a `closePreviousDay` that closed off exactly
// one date on launch — the last day the app was open, if nothing was recorded
// on it. The mark was what told `coverage` a genuine zero from a day nobody
// looked at.
//
// That distinction is gone. A day with no expense on it is a day without an
// expense; the app no longer asks anybody to confirm it, and a forgotten
// Tuesday is filled in by typing the row, not by clearing a flag
// (`DECISIONS.md` → "Every empty day is a no-spend day"). The table stays —
// rows exist on the device and on the server — and nothing writes to it.

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

// ── first pair ──────────────────────────────────────────────────────────────

/**
 * Put every existing row in the outbox, once.
 *
 * A device that has been recording for weeks has an empty outbox — nothing was
 * queued, because nothing was paired. Without this the server would learn only
 * about rows written *after* pairing, and the second device would sync down a
 * ledger that starts on a Tuesday in October.
 *
 * Idempotent by way of being a no-op the second time: it refuses to run if the
 * outbox already holds anything, and pairing writes the base URL before calling
 * it, so `enqueue` is live by then and ordinary writes are not lost either.
 */
export async function seedOutbox(): Promise<number> {
	const database = db();
	if ((await database.outbox.count()) > 0) return 0;

	const queue = async (entity: SyncedEntity, rows: { id: string }[]) => {
		for (const row of rows) await enqueue(entity, row.id, row);
	};

	await queue('account', await database.accounts.toArray());
	await queue('category', await database.categories.toArray());
	await queue('txn', await database.txns.toArray());
	await queue('goal', await database.goals.toArray());
	await queue('monthTarget', await database.monthTargets.toArray());
	await queue('holding', await database.holdings.toArray());
	await queue('valuation', await database.valuations.toArray());
	await queue('schedule', await database.schedules.toArray());
	await queue('reconciliation', await database.reconciliations.toArray());

	// Day marks are keyed by their date rather than an id.
	for (const mark of await database.dayMarks.toArray()) {
		await enqueue('dayMark', mark.date, mark);
	}

	return database.outbox.count();
}

/**
 * Join a ledger that already exists somewhere else.
 *
 * Every device seeds itself on first launch — one account, the starter
 * categories — because until it is paired it is the only device there is. Pair
 * two of them and the ledger has two accounts and two of every bucket, and each
 * device shows an empty tape while holding the other's rows: they belong to an
 * account it is not looking at.
 *
 * So a device gives up a seed it has never written into. The test is not "is
 * this database empty" — by the time this runs the pull has already landed the
 * *other* device's rows, and counting those would make every device look busy.
 * It is narrower and it is the right question: **does an account this device
 * created still have no transactions of its own?** If so it is a seed nobody
 * used, and the older account is the real one.
 *
 * A device that has recorded something keeps its account, and two accounts then
 * stand — which is a genuine question for a human rather than something to
 * guess at.
 *
 * Soft-deleted like everything else (rule 2), and the tombstones sync.
 *
 * Returns the account now active, or null if nothing changed.
 */
export async function adoptRemoteLedger(): Promise<string | null> {
	const database = db();

	/**
	 * Asked once, then never again.
	 *
	 * This runs after **every** pull, and two live accounts is a perfectly
	 * ordinary steady state — a bank account and cash. Without this flag the
	 * scans below became the resting cost of being paired: the whole `txns`
	 * table and the whole `categories` table materialised as objects, on the
	 * main thread, on every cycle, to re-answer a question settled at pairing.
	 *
	 * The flag is set the first time the question gets a real answer — adopted
	 * or decided against — which is the moment it stops being able to change.
	 */
	if (await getMeta<boolean>(META_ADOPTED)) return null;

	const accounts = (await database.accounts.toArray()).filter((a) => !a.isDeleted);
	// Still the only device there is. The question is not yet answerable, so
	// the flag stays unset and the next pull asks again — this is two reads.
	if (accounts.length < 2) return null;

	const deviceId = await getDeviceId();

	// Which accounts have been written into, asked per account through the
	// `accountId` index and stopped at the first live row. A soft-deleted
	// transaction is not evidence of use — same test as before — but this
	// streams to the first match instead of materialising the whole ledger.
	const used = new Set<string>();
	for (const account of accounts) {
		const first = await database.txns
			.where('accountId')
			.equals(account.id)
			.filter((t) => !t.isDeleted)
			.first();
		if (first) used.add(account.id);
	}

	// Mine, and never written into. Anything else is somebody's real ledger.
	const redundant = accounts.filter((a) => a.deviceId === deviceId && !used.has(a.id));
	if (redundant.length === 0 || redundant.length === accounts.length) {
		// A real second account, or nothing of this device's left to give up.
		// Either way the answer will not change again.
		await setMeta(META_ADOPTED, true);
		return null;
	}

	// UUIDv7 is time-sortable, so the smallest id is the account that existed
	// first — the one the other device has been writing into all along.
	const keep = [...accounts]
		.filter((a) => !redundant.includes(a))
		.sort((a, b) => a.id.localeCompare(b.id))[0]!;

	const stamped = await stamp();
	for (const account of redundant) {
		const next: Account = { ...account, isDeleted: true, ...stamped };
		await database.accounts.put(next);
		await enqueue('account', next.id, next);
	}

	// The starter categories duplicated too. Drop this device's unused copies of
	// any bucket name that also arrived from elsewhere; keep anything genuinely
	// new, and keep anything a transaction already points at.
	//
	// This does read the ledger, and it is the one place that has to: "which
	// buckets has anything ever been filed under" is a question about every
	// row. It is affordable because it is now reached at most once in a
	// device's life — the flag at the top of this function is what makes it so.
	const categories = (await database.categories.toArray()).filter((c) => !c.isDeleted);
	const referenced = new Set<string>();
	await database.txns.each((t) => {
		if (!t.isDeleted && t.categoryId !== null) referenced.add(t.categoryId);
	});

	const byName = new Map<string, Category[]>();
	for (const category of categories) {
		const key = normalize(category.name);
		const group = byName.get(key);
		if (group) group.push(category);
		else byName.set(key, [category]);
	}

	for (const group of byName.values()) {
		if (group.length < 2) continue;
		const oldest = [...group].sort((a, b) => a.id.localeCompare(b.id))[0]!;
		for (const category of group) {
			if (category.id === oldest.id) continue;
			if (category.deviceId !== deviceId) continue;
			if (referenced.has(category.id)) continue;

			const next: Category = { ...category, isDeleted: true, ...stamped };
			await database.categories.put(next);
			await enqueue('category', next.id, next);
		}
	}

	await setActiveAccountId(keep.id);
	// Adopted. There is nothing left to decide, so no later pull re-asks.
	await setMeta(META_ADOPTED, true);
	return keep.id;
}

// ── backup ──────────────────────────────────────────────────────────────────

/**
 * The backup format's own version, independent of the Dexie schema version.
 *
 * It moves whenever a table is added to the file, because that is exactly the
 * change an older build cannot represent:
 *   1 → the original six tables · 2 → monthTargets · 3 → holdings, valuations
 *   4 → schedules · 5 → reconciliations
 */
export const BACKUP_VERSION = 5;

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
	reconciliations: Reconciliation[];
}

/**
 * Until sync exists, this file is the only copy of the ledger that survives a
 * cleared browser profile. Settings nags about it for a reason.
 *
 * Every table that holds user data goes in, including ones nothing writes yet:
 * a backup that silently omits a table is a backup that loses it the moment the
 * feature behind that table ships.
 */
export async function exportBackup(): Promise<Backup> {
	const database = db();
	return {
		format: 'finance-backup',
		version: BACKUP_VERSION,
		exportedAt: nowIso(),
		accounts: await database.accounts.toArray(),
		categories: await database.categories.toArray(),
		txns: await database.txns.toArray(),
		dayMarks: await database.dayMarks.toArray(),
		goals: await database.goals.toArray(),
		monthTargets: await database.monthTargets.toArray(),
		holdings: await database.holdings.toArray(),
		valuations: await database.valuations.toArray(),
		schedules: await database.schedules.toArray(),
		reconciliations: await database.reconciliations.toArray()
	};
}

export interface ImportResult {
	accounts: number;
	categories: number;
	txns: number;
}

/**
 * Merge a backup in. Same last-write-wins rule the sync layer will use.
 *
 * A backup written by a *newer* build is refused rather than merged. Merging it
 * would drop every table this build does not know about — and then the next
 * export would write the truncated version back out, so the refusal is what
 * stops one stale device from quietly eating the tables it cannot see.
 *
 * An *older* backup is fine: a table it does not carry is a table that was
 * empty when it was written.
 */
export async function importBackup(backup: Backup): Promise<ImportResult> {
	if (backup?.format !== 'finance-backup') {
		throw new Error('Tohle není záloha téhle aplikace.');
	}

	const version = backup.version;
	if (typeof version !== 'number' || !Number.isFinite(version)) {
		throw new Error('Záloha neuvádí svou verzi — načíst ji bezpečně nejde.');
	}
	if (version > BACKUP_VERSION) {
		throw new Error(
			`Záloha je z novější verze aplikace (${version} > ${BACKUP_VERSION}). ` +
				'Aktualizuj aplikaci a zkus to znovu.'
		);
	}

	const database = db();

	// Resolved **before** the transaction: `enqueue` reads `meta` on its first
	// call, and `meta` is not one of the tables below. Asking now means the
	// answer is cached by the time a row is written inside.
	await refreshSyncEnabled();

	// Ten tables, plus the outbox — a restore is a mutation like any other
	// (rule 4) and everything it writes has to be able to leave the device.
	// Same transaction, so the rows and the queue entries for them commit
	// together or not at all.
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
			database.schedules,
			database.reconciliations,
			database.outbox
		],
		async () => {
			await mergeRows(
				'account',
				backup.accounts ?? [],
				(id) => database.accounts.get(id),
				(row) => database.accounts.put(row)
			);
			await mergeRows(
				'category',
				backup.categories ?? [],
				(id) => database.categories.get(id),
				(row) => database.categories.put(row)
			);
			await mergeRows(
				'txn',
				backup.txns ?? [],
				(id) => database.txns.get(id),
				(row) => database.txns.put(row)
			);
			await mergeRows(
				'goal',
				backup.goals ?? [],
				(id) => database.goals.get(id),
				(row) => database.goals.put(row)
			);
			await mergeRows(
				'monthTarget',
				backup.monthTargets ?? [],
				(id) => database.monthTargets.get(id),
				(row) => database.monthTargets.put(row)
			);
			await mergeRows(
				'holding',
				backup.holdings ?? [],
				(id) => database.holdings.get(id),
				(row) => database.holdings.put(row)
			);
			await mergeRows(
				'valuation',
				backup.valuations ?? [],
				(id) => database.valuations.get(id),
				(row) => database.valuations.put(row)
			);
			await mergeRows(
				'schedule',
				backup.schedules ?? [],
				(id) => database.schedules.get(id),
				(row) => database.schedules.put(row)
			);
			await mergeRows(
				'reconciliation',
				backup.reconciliations ?? [],
				(id) => database.reconciliations.get(id),
				(row) => database.reconciliations.put(row)
			);
			for (const mark of backup.dayMarks ?? []) {
				await database.dayMarks.put(mark);
				await enqueue('dayMark', mark.date, mark);
			}
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

/**
 * Last-write-wins on updatedAt, tiebreak on deviceId — the §5.3 rule.
 *
 * Every row this actually writes is enqueued. A restore is the one path where
 * skipping the outbox seam costs the most: the screens fill up, the ledger
 * looks right, and none of it ever reaches the server or the second device —
 * which then keeps pushing the pre-restore rows back. `entity` is here for no
 * other reason.
 */
async function mergeRows<T extends Versioned>(
	entity: SyncedEntity,
	rows: T[],
	read: (id: string) => Promise<T | undefined>,
	write: (row: T) => Promise<unknown>
): Promise<void> {
	for (const incoming of rows) {
		const existing = await read(incoming.id);
		if (!existing) {
			await write(incoming);
			await enqueue(entity, incoming.id, incoming);
			continue;
		}
		const wins =
			incoming.updatedAt > existing.updatedAt ||
			(incoming.updatedAt === existing.updatedAt && incoming.deviceId > existing.deviceId);
		// A delete is never undone by a merge (§4).
		if (!wins) continue;

		const merged = { ...incoming, isDeleted: incoming.isDeleted || existing.isDeleted };
		await write(merged);
		await enqueue(entity, merged.id, merged);
	}
}
