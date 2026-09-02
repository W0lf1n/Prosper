/**
 * Every write to the database goes through this file.
 *
 * It owns three invariants so no caller has to remember them:
 *   1. `updatedAt` / `deviceId` are stamped on every mutation.
 *   2. Deletes are soft. Nothing calls `.delete()` on user data, ever (§11.2).
 *   3. Mutations pass through `enqueue()`, the seam the P2 outbox plugs into.
 */

import {
	EXCHANGE_CATEGORY_ID,
	EXCHANGE_CATEGORY_NAME,
	availableCurrencies,
	homeCurrency,
	inCurrency,
	pocketsOf,
	validatePocket
} from '$lib/domain/accounts';
import { monthKey, nowIso, startOfMonth, today } from '$lib/domain/datetime';
import { goalStatus, validateGoal, validateGoalShape } from '$lib/domain/goals';
import { DEFAULT_REMINDER_DAYS } from '$lib/domain/holdings';
import {
	dueSchedules,
	partitionByMode,
	sharesForPosting,
	type DueItem
} from '$lib/domain/recurring';
import { newDeviceId, uuidv7 } from '$lib/domain/ids';
import { ADJUSTMENT_PAYEE, reconcileDelta } from '$lib/domain/reconcile';
import { MAX_SHARES, isOpenShare, sharesOf } from '$lib/domain/receivables';
import { ZERO, abs, neg, type Minor } from '$lib/domain/money';
import type {
	AccountPocket,
	Account,
	Category,
	DayMark,
	Goal,
	Holding,
	MonthTarget,
	Reconciliation,
	Schedule,
	ScheduleShare,
	SyncedEntity,
	Txn,
	TxnShare,
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
const META_TAPE_COLLAPSED = 'tapeCollapsedMonths';

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

/**
 * Which months on `/vypis` are folded shut.
 *
 * A view preference, so it lives in `meta` rather than in a synced table — the
 * phone and the laptop are looking at different amounts of screen and have no
 * business agreeing about this. It is not `localStorage` either: §13.10 keeps
 * that for the theme alone, and this is one read on a screen that is already
 * waiting on IndexedDB for the ledger itself.
 *
 * Stored as the exception rather than the state: months are open unless named,
 * so a month recorded for the first time is open, and nothing has to be written
 * when one scrolls into existence.
 */
export async function getCollapsedMonths(): Promise<string[]> {
	const stored = await getMeta<unknown>(META_TAPE_COLLAPSED);
	return Array.isArray(stored)
		? stored.filter((key): key is string => typeof key === 'string')
		: [];
}

export async function setCollapsedMonths(keys: string[]): Promise<void> {
	await setMeta(META_TAPE_COLLAPSED, keys);
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
		pockets: [],
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

/** A share as a form hands it over — before an id, sign or trim. */
export interface NewShare {
	who?: string | null;
	amount: Minor;
}

/** Positive magnitudes, trimmed names, zeroes dropped, fresh ids, and at most
    `MAX_SHARES` of them. Clamped here rather than at the form, because the
    sheets are not the only things that will ever call this. */
function normalizeShares(shares: readonly NewShare[] | undefined): TxnShare[] {
	return (shares ?? [])
		.filter((share) => share.amount !== 0)
		.slice(0, MAX_SHARES)
		.map((share) => ({
			id: uuidv7(),
			who: share.who?.trim() ?? '',
			amount: abs(share.amount),
			settledByTxnId: null
		}));
}

export interface NewTxn {
	accountId: string;
	amount: Minor;
	date?: string;
	categoryId?: string | null;
	payee?: string;
	note?: string | null;
	source?: TxnSource;
	isOneOff?: boolean;
	/** Who pays parts of this back. Empty for most rows. */
	shares?: NewShare[];
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
		shares: normalizeShares(input.shares),
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
		'amount' | 'date' | 'categoryId' | 'payee' | 'note' | 'isCleared' | 'isOneOff' | 'shares'
	>
>;

export async function updateTxn(id: string, patch: TxnPatch): Promise<Txn | undefined> {
	const database = db();
	const existing = await database.txns.get(id);
	if (!existing) return undefined;

	const next: Txn = {
		...existing,
		...patch,
		/* Same normalisation as `createTxn`, but in place — ids and settlements
		   survive an edit, a share emptied to zero is a share taken off the row. */
		...(patch.shares === undefined
			? {}
			: {
					shares: patch.shares
						.filter((share) => share.amount !== 0)
						.map((share) => ({ ...share, who: share.who.trim(), amount: abs(share.amount) }))
				}),
		...(await stamp())
	};
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
	return next;
}

/**
 * Soft delete. The row stays, flagged, forever.
 *
 * A transfer leg takes its pair with it (Q49): a transfer is one fact told as
 * two rows, and deleting half of it would leave a phantom expense on one
 * account and free money on the other.
 */
export async function deleteTxn(id: string): Promise<void> {
	const database = db();
	const existing = await database.txns.get(id);
	if (!existing || existing.isDeleted) return;

	const next: Txn = { ...existing, isDeleted: true, ...(await stamp()) };
	await database.txns.put(next);
	await enqueue('txn', next.id, next);

	if (existing.transferPairId) {
		const pair = await database.txns.get(existing.transferPairId);
		if (pair && !pair.isDeleted) {
			const gone: Txn = { ...pair, isDeleted: true, ...(await stamp()) };
			await database.txns.put(gone);
			await enqueue('txn', gone.id, gone);
		}
	}
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

	// The undo of a transfer delete brings back both legs, same as the delete
	// took both — the toast's undo is the only caller, moments later.
	if (existing.transferPairId) {
		const pair = await database.txns.get(existing.transferPairId);
		if (pair?.isDeleted) {
			const back: Txn = { ...pair, isDeleted: false, ...(await stamp()) };
			await database.txns.put(back);
			await enqueue('txn', back.id, back);
		}
	}
}

// ── receivables ─────────────────────────────────────────────────────────────

/**
 * Somebody paid you back — one share of one expense (Q47).
 *
 * Creates the inflow that carries the money and links it to the share it
 * settles. Until this runs, the outstanding amount is not in the balance and
 * not in any total — you paid the whole thing, because you did. The row's
 * other shares are untouched: Friend1 paying up says nothing about Friend2.
 *
 * Writing the row back through `sharesOf` is deliberate — it is what upgrades
 * a legacy single-share row to the array shape the first time it is settled.
 */
export async function settleReceivable(
	txnId: string,
	shareId: string,
	date?: string
): Promise<Txn | undefined> {
	const database = db();
	const original = await database.txns.get(txnId);
	if (!original || original.isDeleted) return undefined;

	const shares = sharesOf(original);
	const share = shares.find((s) => s.id === shareId);
	if (!share || !isOpenShare(share)) return undefined;

	const repayment = await createTxn({
		accountId: original.accountId,
		amount: share.amount,
		date: date ?? today(),
		categoryId: original.categoryId,
		payee: share.who.trim() ? `vrácení — ${share.who.trim()}` : 'vrácení',
		note: `k výdaji „${original.payee || 'bez popisu'}“`
	});

	const next: Txn = {
		...original,
		shares: shares.map((s) => (s.id === shareId ? { ...s, settledByTxnId: repayment.id } : s)),
		...(await stamp())
	};
	await database.txns.put(next);
	await enqueue('txn', next.id, next);
	return repayment;
}

/** Undo of the above: removes the inflow and reopens that one share. */
export async function unsettleReceivable(txnId: string, shareId: string): Promise<void> {
	const database = db();
	const original = await database.txns.get(txnId);
	if (!original) return;

	const shares = sharesOf(original);
	const share = shares.find((s) => s.id === shareId);
	if (!share?.settledByTxnId) return;

	await deleteTxn(share.settledByTxnId);
	const next: Txn = {
		...original,
		shares: shares.map((s) => (s.id === shareId ? { ...s, settledByTxnId: null } : s)),
		...(await stamp())
	};
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

/**
 * Money from elsewhere joins the account — Q50.
 *
 * The koruny on a Revolut card do not get an account of their own; they are
 * part of the CZK account and this is how they get in. A pocket is opening
 * money with a name on it, and it is written the way the opening balance is:
 * a field on the account row, stamped and queued as one change.
 */
export async function addPocket(
	accountId: string,
	input: { name: string; amount: Minor }
): Promise<AccountPocket | undefined> {
	const database = db();
	const existing = await database.accounts.get(accountId);
	if (!existing || existing.isDeleted) return undefined;
	if (validatePocket(input).length > 0) return undefined;

	const pocket: AccountPocket = { id: uuidv7(), name: input.name.trim(), amount: input.amount };
	const next: Account = {
		...existing,
		pockets: [...pocketsOf(existing), pocket],
		...(await stamp())
	};
	await database.accounts.put(next);
	await enqueue('account', next.id, next);
	return pocket;
}

/** The pocket was a mistake, or the money left for good. Either way the
    balance stops counting it — a pocket is a stated figure, not a row, so
    there is nothing to tombstone. */
export async function removePocket(accountId: string, pocketId: string): Promise<void> {
	const database = db();
	const existing = await database.accounts.get(accountId);
	if (!existing || existing.isDeleted) return;

	const next: Account = {
		...existing,
		pockets: pocketsOf(existing).filter((p) => p.id !== pocketId),
		...(await stamp())
	};
	await database.accounts.put(next);
	await enqueue('account', next.id, next);
}

/**
 * Thrown by `createAccount` for a currency a live account already holds —
 * one account per currency (Q50). The form never offers such a currency; the
 * guard exists because a rule that lives only in a form is not a rule.
 */
export class CurrencyTakenError extends Error {
	constructor(public readonly currency: string) {
		super(`An account in ${currency} already exists`);
		this.name = 'CurrencyTakenError';
	}
}

export async function createAccount(
	input: Pick<Account, 'name' | 'kind'> &
		Partial<Pick<Account, 'currency' | 'openingBalance' | 'openingDate'>>
): Promise<Account> {
	const database = db();
	const currency = input.currency ?? 'CZK';
	if (!availableCurrencies(await database.accounts.toArray()).includes(currency)) {
		throw new CurrencyTakenError(currency);
	}

	const { updatedAt, deviceId } = await stamp();
	const account: Account = {
		id: uuidv7(),
		name: input.name.trim(),
		kind: input.kind,
		openingBalance: input.openingBalance ?? ZERO,
		openingDate: input.openingDate ?? today(),
		pockets: [],
		// Chosen once, at the counter. There is deliberately no way to change it
		// later — an account with rows in it cannot switch currency without
		// silently redenominating its whole history (Q49).
		currency,
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

// ── transfers ───────────────────────────────────────────────────────────────

export interface NewTransfer {
	fromAccountId: string;
	toAccountId: string;
	/** What leaves, positive magnitude, in the source account's currency. */
	amountOut: Minor;
	/** What lands, positive magnitude, in the target account's currency. The
	    pair of amounts *is* the exchange rate; nothing else records one (Q49). */
	amountIn: Minor;
	/** The bucket the outgoing leg is spent from — DOVOLENÁ, LIFESTYLE, the
	    mortgage's. The incoming leg lands in SMĚNA on its own. */
	categoryId: string;
	date?: string;
	note?: string | null;
}

export interface Transfer {
	out: Txn;
	in: Txn;
}

/**
 * The income bucket every exchange lands in, created the first time it is
 * needed. A constant id rather than `uuidv7()`: two paired devices that each
 * write their first exchange before a sync produce the same row, and the
 * merge collapses them instead of leaving two SMĚNA buckets. An archived one
 * is still used — the leg needs a bucket and the person can un-archive it.
 */
export async function ensureExchangeCategory(): Promise<Category> {
	const database = db();
	const existing = await database.categories.get(EXCHANGE_CATEGORY_ID);
	if (existing && !existing.isDeleted) return existing;

	const { updatedAt, deviceId } = await stamp();
	const category: Category = {
		id: EXCHANGE_CATEGORY_ID,
		parentId: null,
		name: EXCHANGE_CATEGORY_NAME,
		/* The same axis value PŘÍJEM carries: income rows never enter the split,
		   so the type is a formality the schema requires. */
		spendType: 'save',
		monthlyCap: null,
		sortOrder: await database.categories.count(),
		isArchived: false,
		isIncome: true,
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await database.categories.put(category);
	await enqueue('category', category.id, category);
	return category;
}

/**
 * Move money between two accounts — §6.1: two rows, mutually referencing
 * `transferPairId`, never one row.
 *
 * Both legs commit together or not at all: one leg alone would be a phantom
 * expense on one account and a phantom windfall on the other. Since
 * 2026-09-02 the legs *count* the way they read — with one account per
 * currency every transfer is an exchange, and the koruna month should show
 * the holiday it paid for: the outgoing leg is an expense from the chosen
 * bucket, the incoming leg is income in SMĚNA. The balances see both, as
 * they always did.
 */
export async function createTransfer(input: NewTransfer): Promise<Transfer> {
	const database = db();
	if (input.fromAccountId === input.toAccountId) {
		throw new Error('Převod potřebuje dva různé účty.');
	}
	if (!input.categoryId) {
		throw new Error('Převod potřebuje kategorii, ze které odchází.');
	}
	const [from, to] = await Promise.all([
		database.accounts.get(input.fromAccountId),
		database.accounts.get(input.toAccountId)
	]);
	if (!from || !to) throw new Error('Účet převodu neexistuje.');

	// Resolved before the transaction — `enqueue` reads `meta` on its first
	// call and `meta` is not one of the tables below (the importBackup trap).
	await refreshSyncEnabled();
	const exchange = await ensureExchangeCategory();

	const { updatedAt, deviceId } = await stamp();
	const date = input.date ?? today();
	const note = input.note?.trim() || null;

	const base = {
		date,
		note,
		source: 'manual' as const,
		isCleared: false,
		isOneOff: false,
		shares: [],
		scheduleId: null,
		createdAt: updatedAt,
		updatedAt,
		deviceId,
		isDeleted: false
	};

	const outLeg: Txn = {
		...base,
		id: uuidv7(),
		accountId: from.id,
		amount: neg(abs(input.amountOut)),
		categoryId: input.categoryId,
		payee: `Převod → ${to.name}`,
		transferPairId: '' // filled below, once the other id exists
	};
	const inLeg: Txn = {
		...base,
		id: uuidv7(),
		accountId: to.id,
		amount: abs(input.amountIn),
		categoryId: exchange.id,
		payee: `Převod ← ${from.name}`,
		transferPairId: outLeg.id
	};
	outLeg.transferPairId = inLeg.id;

	await database.transaction('rw', [database.txns, database.outbox], async () => {
		await database.txns.bulkPut([outLeg, inLeg]);
		await enqueue('txn', outLeg.id, outLeg);
		await enqueue('txn', inLeg.id, inLeg);
	});

	return { out: outLeg, in: inLeg };
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

/** The schedule flavour of `normalizeShares` — no settlement to carry. */
function normalizeScheduleShares(shares: readonly NewShare[] | undefined): ScheduleShare[] {
	return (shares ?? [])
		.filter((share) => share.amount !== 0)
		.slice(0, MAX_SHARES)
		.map((share) => ({ id: uuidv7(), who: share.who?.trim() ?? '', amount: abs(share.amount) }));
}

export async function createSchedule(
	input: Pick<Schedule, 'accountId' | 'payee' | 'categoryId' | 'amount' | 'dayOfMonth'> &
		Partial<Pick<Schedule, 'startMonth' | 'endMonth' | 'mode'>> & { shares?: NewShare[] }
): Promise<Schedule> {
	const database = db();
	const { updatedAt, deviceId } = await stamp();
	const schedule: Schedule = {
		id: uuidv7(),
		accountId: input.accountId,
		payee: input.payee.trim(),
		categoryId: input.categoryId,
		amount: input.amount,
		dayOfMonth: Math.min(31, Math.max(1, Math.trunc(input.dayOfMonth))),
		startMonth: input.startMonth ?? monthKey(today()),
		endMonth: input.endMonth ?? null,
		mode: input.mode ?? 'confirm',
		/* The shares that come back, if the payment is shared. Normalised here
		   rather than at the form, because the sheet is not the only thing that
		   will ever call this. */
		shares: normalizeScheduleShares(input.shares),
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
			| 'accountId'
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
	> & { shares?: NewShare[] }
): Promise<void> {
	const database = db();
	const existing = await database.schedules.get(id);
	if (!existing) return;

	/* Shares are pulled out of the spread so the row never briefly holds the
	   form's raw shape: same normalisation as `createSchedule` — positive
	   magnitudes, and a share of zero is a share taken off the list. Fresh ids
	   every save; schedule shares carry no settlement, so nothing points at them. */
	const { shares, ...rest } = patch;
	const next: Schedule = {
		...existing,
		...rest,
		...(shares === undefined ? {} : { shares: normalizeScheduleShares(shares) }),
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
		/* The schedule's own account since v11 (Q49); `options.accountId` — the
		   active account — is the fallback for a row an older build wrote
		   without one, which is what every schedule meant while there was only
		   one account. */
		accountId: item.schedule.accountId || options.accountId,
		amount,
		date: item.date,
		categoryId: item.schedule.categoryId,
		payee: item.schedule.payee,
		source: 'recurring',
		scheduleId: item.schedule.id,
		/**
		 * The declared shares ride onto the row, so a shared mortgage produces
		 * its open receivables every month without anybody retyping who owes
		 * what (Q46, Q47). `sharesForPosting` owns the two rules: only an
		 * outflow, and together never more than the row itself — an overridden
		 * amount smaller than the shares would otherwise book back more than
		 * went out.
		 */
		shares: sharesForPosting(item.schedule, amount)
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
		Partial<Pick<Goal, 'linkedAccountId' | 'categoryId' | 'startDate' | 'startAmount'>>
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
		// ...unless a head start is claimed on purpose — Q48. Signed, unlike the
		// target: a pot restated later can also have shrunk.
		startAmount: input.startAmount ?? ZERO,
		isPinned: false,
		updatedAt,
		deviceId,
		isDeleted: false
	};
	await db().goals.put(goal);
	await enqueue('goal', goal.id, goal);
	return goal;
}

export type GoalPatch = Partial<
	Pick<
		Goal,
		'name' | 'why' | 'targetAmount' | 'targetDate' | 'categoryId' | 'startDate' | 'startAmount'
	>
>;

/**
 * "Na očích" — put this goal on the entry screen, and take it off the others.
 *
 * Exclusive by construction rather than by the caller remembering: there is one
 * strip on that screen, so there is one pin. Passing the id of the goal that
 * already holds it clears it and hands the choice back to `pickPrimary`'s
 * fallback.
 *
 * Every row it changes is stamped and queued — the pin travels between devices
 * like anything else, because "the goal I am thinking about" is a fact about
 * the person, not about the phone.
 */
export async function pinGoal(id: string | null): Promise<void> {
	const database = db();
	const stamped = await stamp();

	await database.transaction('rw', [database.goals, database.outbox], async () => {
		for (const goal of await database.goals.toArray()) {
			if (goal.isDeleted) continue;
			const shouldPin = goal.id === id;
			if (goal.isPinned === shouldPin) continue;

			const next: Goal = { ...goal, isPinned: shouldPin, ...stamped };
			await database.goals.put(next);
			await enqueue('goal', next.id, next);
		}
	});
}

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

/**
 * Write this month's number for every goal that has not got one yet.
 *
 * Called from the layout load, next to `catchUpSchedules`, because it is the
 * same kind of job: something that should have happened while the app was shut,
 * and there is no server to have done it.
 *
 * **Why this exists at all.** Until 2026-08-28 the number was only a
 * *suggestion* until somebody pressed Potvrdit, and a month nobody confirmed
 * scored neither ✓ nor ✗ — it read `bez cíle`. That put a monthly ritual in
 * front of the record, and the case it was protecting against turned out to be
 * thin: not wanting a goal this month is expressed by not putting anything in
 * it. So the arithmetic commits itself and the record means something without
 * being asked. Overriding it is still one tap on `/cil` — that is the case the
 * confirmation was really for, and it is the only one left.
 *
 * Two things it deliberately does not do. It never touches a month that already
 * has a written target, so an override survives every launch. And it never
 * backfills a past month: a target invented today, out of a remaining balance
 * that has moved since, is not what that month was aiming at, and stamping ✗ on
 * it retroactively would be the app making something up.
 */
export async function catchUpGoalTargets(): Promise<number> {
	const database = db();
	const month = monthKey(today());
	const goals = (await database.goals.toArray()).filter((g) => !g.isDeleted);
	if (goals.length === 0) return 0;

	const [txns, categories, targets, accounts] = await Promise.all([
		database.txns.toArray(),
		database.categories.toArray(),
		database.monthTargets.toArray(),
		database.accounts.toArray()
	]);
	// Goals are denominated in the home currency, so only home-currency
	// accounts' rows may count toward them — euro cents summed into a koruna
	// target would be a number meaning nothing (Q49).
	const live = inCurrency(txns, accounts, homeCurrency(accounts)).filter((t) => !t.isDeleted);

	let written = 0;
	for (const goal of goals) {
		const already = targets.find((t) => !t.isDeleted && t.goalId === goal.id && t.month === month);
		if (already) continue;

		const status = goalStatus({ goal, txns: live, categories, month });
		// A goal already reached has nothing left to aim at this month, and a
		// zero target would score ✓ every month for ever.
		if (status.isComplete || status.suggestedMonthly <= 0) continue;

		await setMonthTarget(goal.id, month, status.suggestedMonthly);
		written += 1;
	}

	return written;
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

// ── starting over ───────────────────────────────────────────────────────────

/** How many live rows the wipe flagged, per table. */
export interface ResetResult {
	txns: number;
	goals: number;
	monthTargets: number;
	holdings: number;
	valuations: number;
	schedules: number;
	reconciliations: number;
}

/**
 * Empty the ledger and leave the app standing — `domain/reset.ts` owns the
 * phrase that unlocks it.
 *
 * What goes is everything that was *recorded*: rows, goals, the month targets
 * under them, holdings and their readings, declared payments, reconciliations.
 * What stays is everything that was *configured*: the account and the category
 * set, both of which took real work to get right and neither of which is
 * history. Somebody starting over still spends on JÍDLO.
 *
 * The account's opening balance goes back to zero as of today, because it is
 * the one piece of configuration that *is* a historical claim — leaving it
 * would open the blank ledger at a balance nothing on screen explains. That is
 * also what re-opens the Účet card in Settings: it collapses once there are
 * rows and this is the thing that removes them.
 *
 * Soft, like every other delete (§13.2). The rows stay flagged and the
 * tombstones queue for the server exactly like a row deleted by hand, so a
 * second device catches up rather than pushing the ledger back.
 *
 * `dayMarks` is deliberately left alone: nothing has written to it since
 * 2026-08-28 and no screen reads it, so there is nothing here to clear.
 */
export async function resetLedger(): Promise<ResetResult> {
	const database = db();

	// Both of these read `meta`, which is not one of the tables below — the
	// same trap `importBackup` documents. Answered here so the writes inside
	// the transaction do not have to go looking.
	await refreshSyncEnabled();
	const stamped = await stamp();

	const result: ResetResult = {
		txns: 0,
		goals: 0,
		monthTargets: 0,
		holdings: 0,
		valuations: 0,
		schedules: 0,
		reconciliations: 0
	};

	await database.transaction(
		'rw',
		[
			database.accounts,
			database.txns,
			database.goals,
			database.monthTargets,
			database.holdings,
			database.valuations,
			database.schedules,
			database.reconciliations,
			database.outbox
		],
		async () => {
			result.txns = await tombstone('txn', await database.txns.toArray(), stamped, (row) =>
				database.txns.put(row)
			);
			result.goals = await tombstone('goal', await database.goals.toArray(), stamped, (row) =>
				database.goals.put(row)
			);
			result.monthTargets = await tombstone(
				'monthTarget',
				await database.monthTargets.toArray(),
				stamped,
				(row) => database.monthTargets.put(row)
			);
			result.holdings = await tombstone(
				'holding',
				await database.holdings.toArray(),
				stamped,
				(row) => database.holdings.put(row)
			);
			result.valuations = await tombstone(
				'valuation',
				await database.valuations.toArray(),
				stamped,
				(row) => database.valuations.put(row)
			);
			result.schedules = await tombstone(
				'schedule',
				await database.schedules.toArray(),
				stamped,
				(row) => database.schedules.put(row)
			);
			result.reconciliations = await tombstone(
				'reconciliation',
				await database.reconciliations.toArray(),
				stamped,
				(row) => database.reconciliations.put(row)
			);

			// The accounts survive; only what they opened at is forgotten.
			for (const account of await database.accounts.toArray()) {
				if (account.isDeleted) continue;
				const next: Account = {
					...account,
					openingBalance: ZERO,
					openingDate: today(),
					pockets: [],
					...stamped
				};
				await database.accounts.put(next);
				await enqueue('account', next.id, next);
			}
		}
	);

	return result;
}

/** Flag every live row in one table and queue it. Returns how many there were. */
async function tombstone<T extends Versioned>(
	entity: SyncedEntity,
	rows: T[],
	stamped: { updatedAt: string; deviceId: string },
	write: (row: T) => Promise<unknown>
): Promise<number> {
	let flagged = 0;
	for (const row of rows) {
		if (row.isDeleted) continue;
		const next = { ...row, isDeleted: true, ...stamped };
		await write(next);
		await enqueue(entity, next.id, next);
		flagged += 1;
	}
	return flagged;
}

// ── backup ──────────────────────────────────────────────────────────────────

/**
 * The backup format's own version, independent of the Dexie schema version.
 *
 * It moves whenever the file changes in a way an older build cannot represent —
 * a table it does not carry, or a row shape it would silently flatten:
 *   1 → the original six tables · 2 → monthTargets · 3 → holdings, valuations
 *   4 → schedules · 5 → reconciliations
 *   6 → `shares` on txns and schedules (Q47) — an older build would read only
 *       the legacy single-share fields and lose every second payer on import
 */
export const BACKUP_VERSION = 6;

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
