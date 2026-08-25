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
	MetaEntry,
	MonthTarget,
	OutboxEntry,
	Reconciliation,
	Txn
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
	}
];

export class FinanceDb extends Dexie {
	accounts!: EntityTable<Account, 'id'>;
	categories!: EntityTable<Category, 'id'>;
	txns!: EntityTable<Txn, 'id'>;
	reconciliations!: EntityTable<Reconciliation, 'id'>;
	goals!: EntityTable<Goal, 'id'>;
	monthTargets!: EntityTable<MonthTarget, 'id'>;
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
