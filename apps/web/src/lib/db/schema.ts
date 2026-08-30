/**
 * IndexedDB schema.
 *
 * Every schema change is a new entry in `migrations` — never an edit to an
 * existing one, even during development, because a released version is already
 * on the phone. Dexie applies them in order for whatever version the browser
 * currently holds.
 *
 * Note on indexes: IndexedDB cannot index booleans, so `isDeleted` and
 * `isArchived` are deliberately not indexed and are filtered in memory. At one
 * user's transaction volume that costs nothing.
 */

import Dexie, { type EntityTable, type Transaction } from 'dexie';
import { normalize } from '$lib/domain/vocabulary';
import type {
	Account,
	Category,
	DayMark,
	Goal,
	Holding,
	MetaEntry,
	MonthTarget,
	OutboxEntry,
	Reconciliation,
	Schedule,
	Txn,
	Valuation
} from '$lib/domain/types';

export interface Migration {
	version: number;
	/** `null` drops a table. See Dexie's `stores()` contract. */
	stores: Record<string, string | null>;
	upgrade?: (tx: Transaction) => void | Promise<unknown>;
}

export const migrations: Migration[] = [
	{
		version: 1,
		stores: {
			accounts: 'id, sortOrder',
			categories: 'id, sortOrder, parentId, spendType',
			txns: 'id, date, accountId, categoryId, createdAt, updatedAt, [accountId+date]',
			reconciliations: 'id, accountId, date',
			goals: 'id, targetDate, updatedAt',
			dayMarks: 'date',
			outbox: '++seq, entity, entityId',
			meta: 'key'
		}
	},
	{
		// Targeting (PROJECT-PLAN §2.2): one written commitment per goal per
		// month. Only the new table is listed — Dexie carries the rest forward.
		version: 2,
		stores: {
			monthTargets: 'id, month, goalId, [goalId+month]'
		}
	},
	{
		/**
		 * `SpendType` gained `give`. No table changes — this only re-files the one
		 * seeded category the new class was added for.
		 *
		 * Narrow on purpose: it touches a bucket only if it is still exactly as
		 * seeded — named DARY and typed `want`. A bucket he has already re-typed
		 * himself is his decision and is left alone. Changing it back is one
		 * dropdown in Settings.
		 */
		version: 3,
		stores: {},
		upgrade: async (tx: Transaction) => {
			const categories = tx.table('categories');
			const rows = await categories.toArray();
			const stamp = new Date().toISOString();
			for (const row of rows) {
				if (row.spendType === 'want' && normalize(row.name) === 'dary') {
					await categories.update(row.id, { spendType: 'give', updatedAt: stamp });
				}
			}
		}
	},
	{
		/**
		 * Holdings and their readings — DECISIONS Q36.
		 *
		 * New tables only, so there is nothing to upgrade: no existing row grows a
		 * column and no existing row is touched. `[holdingId+date]` is what picks
		 * the current value without loading every reading ever taken.
		 */
		version: 4,
		stores: {
			holdings: 'id, sortOrder, categoryId',
			valuations: 'id, holdingId, date, [holdingId+date]'
		}
	},
	{
		/**
		 * Declared recurring payments — DECISIONS Q40.
		 *
		 * `txns` is restated in full because it grows an index: Dexie replaces the
		 * whole declaration for a table it is given, so every existing index has
		 * to be repeated or it is dropped.
		 *
		 * The upgrade backfills `scheduleId: null` on every existing row rather
		 * than leaving it absent. An index over a field that is `undefined` on
		 * most rows works, but `row.scheduleId === null` then answers false for
		 * the entire pre-existing ledger, and that is the kind of difference that
		 * shows up months later as one screen disagreeing with another.
		 */
		version: 5,
		stores: {
			schedules: 'id, sortOrder, categoryId',
			txns: 'id, date, accountId, categoryId, createdAt, updatedAt, scheduleId, [accountId+date]'
		},
		upgrade: async (tx: Transaction) => {
			await tx
				.table('txns')
				.toCollection()
				.modify((row: { scheduleId?: string | null }) => {
					if (row.scheduleId === undefined) row.scheduleId = null;
				});
		}
	},
	{
		/**
		 * `Holding.startDate` — the day a holding starts counting contributions.
		 *
		 * No index changes, so `holdings` is not restated. The backfill is the
		 * interesting part: an existing holding has no record of when it was
		 * written, and deriving it from the UUIDv7 timestamp is the trap Q27
		 * already refused — the id would silently become a business-meaningful
		 * field.
		 *
		 * So it is backfilled from the evidence that does exist: the first of the
		 * month of the holding's **earliest reading**, falling back to the first
		 * of the current month for one that has never been valued. Both are
		 * guesses, both are conservative — they never claim a contribution the
		 * holding might not have received — and both are one field away from
		 * being corrected in Settings.
		 */
		version: 6,
		stores: {},
		upgrade: async (tx: Transaction) => {
			const valuations = await tx.table('valuations').toArray();
			const earliest = new Map<string, string>();
			for (const row of valuations) {
				const current = earliest.get(row.holdingId);
				if (current === undefined || row.date < current) earliest.set(row.holdingId, row.date);
			}

			const fallback = `${new Date().toISOString().slice(0, 7)}-01`;
			await tx
				.table('holdings')
				.toCollection()
				.modify((row: { id: string; startDate?: string }) => {
					if (row.startDate !== undefined) return;
					const seen = earliest.get(row.id);
					row.startDate = seen ? `${seen.slice(0, 7)}-01` : fallback;
				});
		}
	},
	{
		/**
		 * `Schedule.owedAmount` / `Schedule.owedBy` — the share of a standing
		 * payment that comes back every month (DECISIONS Q46).
		 *
		 * No index changes, so `schedules` is not restated — Dexie replaces a
		 * table's whole declaration and restating it wrongly is how indexes get
		 * dropped.
		 *
		 * The backfill writes `null` rather than leaving the fields absent, for
		 * the reason v5 did the same to `scheduleId`: `row.owedAmount === null`
		 * would otherwise answer false for every schedule declared before today,
		 * and that is the class of difference that surfaces months later as one
		 * screen disagreeing with another.
		 */
		version: 7,
		stores: {},
		upgrade: async (tx: Transaction) => {
			await tx
				.table('schedules')
				.toCollection()
				.modify((row: { owedAmount?: number | null; owedBy?: string | null }) => {
					if (row.owedAmount === undefined) row.owedAmount = null;
					if (row.owedBy === undefined) row.owedBy = null;
				});
		}
	},
	{
		/**
		 * `Goal.isPinned` — which goal gets the strip on the entry screen.
		 *
		 * No index changes, so `goals` is not restated: Dexie replaces a table's
		 * whole declaration and restating it wrongly is how indexes get dropped.
		 * IndexedDB cannot index a boolean anyway, and one person has a handful
		 * of goals.
		 *
		 * Backfilled to `false` rather than left absent, for the reason v5 did
		 * the same to `scheduleId` and v7 to `owedAmount`: `row.isPinned ===
		 * false` would otherwise answer false for every goal written before
		 * today. The pin then goes to whichever goal the old rule would have
		 * chosen anyway — nothing, so the fallback keeps running until somebody
		 * picks one.
		 */
		version: 8,
		stores: {},
		upgrade: async (tx: Transaction) => {
			await tx
				.table('goals')
				.toCollection()
				.modify((row: { isPinned?: boolean }) => {
					if (row.isPinned === undefined) row.isPinned = false;
				});
		}
	},
	{
		/**
		 * `Txn.shares` / `Schedule.shares` — several people paying back one
		 * expense (DECISIONS Q47).
		 *
		 * The single `owedAmount` / `owedBy` (/ `settledByTxnId`) trio becomes an
		 * array of shares, each with its own settlement. No index changes — the
		 * old fields were never indexed and the new one is an array of objects,
		 * which IndexedDB could not index anyway — so neither table is restated.
		 *
		 * The backfill wraps an existing share into a one-element array and gives
		 * an empty row an empty one, explicitly, for the reason v5 backfilled
		 * `scheduleId`: an absent field is not an empty list, and every reader
		 * would need a guard forever. The legacy fields are left in place on old
		 * rows — they are the audit trail of what this migration read, and
		 * `sharesOf()` prefers the array whenever both exist.
		 *
		 * The synthesised share's id is the same constant `sharesOf()` uses for a
		 * legacy row it meets at read time (an old backup merged in later), so
		 * one share never changes identity depending on which path it took.
		 */
		version: 9,
		stores: {},
		upgrade: async (tx: Transaction) => {
			interface LegacyOwedRow {
				shares?: unknown;
				owedAmount?: number | null;
				owedBy?: string | null;
				settledByTxnId?: string | null;
			}
			await tx
				.table('txns')
				.toCollection()
				.modify((row: LegacyOwedRow) => {
					if (Array.isArray(row.shares)) return;
					row.shares = row.owedAmount
						? [
								{
									id: 'legacy',
									who: row.owedBy ?? '',
									amount: Math.abs(row.owedAmount),
									settledByTxnId: row.settledByTxnId ?? null
								}
							]
						: [];
				});
			await tx
				.table('schedules')
				.toCollection()
				.modify((row: LegacyOwedRow) => {
					if (Array.isArray(row.shares)) return;
					row.shares = row.owedAmount
						? [{ id: 'legacy', who: row.owedBy ?? '', amount: Math.abs(row.owedAmount) }]
						: [];
				});
		}
	},
	{
		/**
		 * `Goal.startAmount` — the stated head start of a goal (DECISIONS Q48).
		 *
		 * No index changes, so `goals` is not restated. Backfilled to zero rather
		 * than left absent, for the standing reason (v5, v7, v8): arithmetic over
		 * an absent field is NaN, and every reader would need a guard for ever.
		 * Zero is also the honest value — a goal written before the field existed
		 * never claimed a head start.
		 */
		version: 10,
		stores: {},
		upgrade: async (tx: Transaction) => {
			await tx
				.table('goals')
				.toCollection()
				.modify((row: { startAmount?: number }) => {
					if (row.startAmount === undefined) row.startAmount = 0;
				});
		}
	}
];

export class FinanceDb extends Dexie {
	accounts!: EntityTable<Account, 'id'>;
	categories!: EntityTable<Category, 'id'>;
	txns!: EntityTable<Txn, 'id'>;
	reconciliations!: EntityTable<Reconciliation, 'id'>;
	goals!: EntityTable<Goal, 'id'>;
	monthTargets!: EntityTable<MonthTarget, 'id'>;
	holdings!: EntityTable<Holding, 'id'>;
	valuations!: EntityTable<Valuation, 'id'>;
	schedules!: EntityTable<Schedule, 'id'>;
	dayMarks!: EntityTable<DayMark, 'date'>;
	outbox!: EntityTable<OutboxEntry, 'seq'>;
	meta!: EntityTable<MetaEntry, 'key'>;

	constructor(name = 'finance') {
		super(name);
		for (const migration of migrations) {
			const version = this.version(migration.version).stores(migration.stores);
			if (migration.upgrade) version.upgrade(migration.upgrade);
		}
	}
}

export const SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

/**
 * The single database instance.
 *
 * Constructed lazily: the module is imported during SSR/prerender where
 * `indexedDB` does not exist, and Dexie must not be instantiated there.
 */
let instance: FinanceDb | null = null;

export function db(): FinanceDb {
	if (!instance) instance = new FinanceDb();
	return instance;
}

/** Test seam — swap in a throwaway database. */
export function setDb(next: FinanceDb | null): void {
	instance = next;
}
