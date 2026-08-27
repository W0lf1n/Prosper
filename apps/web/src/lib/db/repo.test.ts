/**
 * The backup is the only copy of the ledger that survives a cleared browser
 * profile, which makes it the one part of `repo.ts` worth testing directly.
 *
 * These run against `fake-indexeddb` rather than the pure domain layer, so they
 * are the exception to "tests live in `domain/`" — the thing being tested here
 * *is* the persistence.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Minor } from '$lib/domain/money';
import type { Reconciliation } from '$lib/domain/types';
import {
	BACKUP_VERSION,
	createTxn,
	deleteTxn,
	ensureSeeded,
	exportBackup,
	importBackup,
	type Backup
} from './repo';
import { FinanceDb, setDb } from './schema';

let db: FinanceDb;
let accountId: string;
let counter = 0;

beforeEach(async () => {
	// A throwaway database per test: Dexie caches schema per name, and a shared
	// one would leak rows between cases.
	counter += 1;
	db = new FinanceDb(`test-${counter}-${Date.now()}`);
	setDb(db);
	({ accountId } = await ensureSeeded());
});

function reconciliation(overrides: Partial<Reconciliation> = {}): Reconciliation {
	return {
		id: `rec-${counter}`,
		accountId,
		date: '2026-08-31',
		statementBalance: 12345 as Minor,
		computedBalance: 12000 as Minor,
		adjustmentTxnId: null,
		updatedAt: '2026-08-31T10:00:00.000Z',
		deviceId: 'test',
		isDeleted: false,
		...overrides
	};
}

describe('exportBackup', () => {
	it('stamps the current format version', async () => {
		const backup = await exportBackup();

		expect(backup.format).toBe('finance-backup');
		expect(backup.version).toBe(BACKUP_VERSION);
	});

	it('carries every table that holds user data', async () => {
		const backup = await exportBackup();

		// A table missing from this list is a table a restore silently loses.
		expect(Object.keys(backup).sort()).toEqual(
			[
				'accounts',
				'categories',
				'dayMarks',
				'exportedAt',
				'format',
				'goals',
				'holdings',
				'monthTargets',
				'reconciliations',
				'schedules',
				'txns',
				'valuations',
				'version'
			].sort()
		);
	});

	it('includes reconciliations, which nothing writes yet', async () => {
		await db.reconciliations.put(reconciliation());

		const backup = await exportBackup();

		expect(backup.reconciliations).toHaveLength(1);
		expect(backup.reconciliations[0]!.statementBalance).toBe(12345);
	});
});

describe('importBackup — the version guard', () => {
	it('refuses a backup from a newer build rather than truncating it', async () => {
		const backup = { ...(await exportBackup()), version: BACKUP_VERSION + 1 };

		await expect(importBackup(backup)).rejects.toThrow(/novější verze/);
	});

	it('refuses a backup with no version at all', async () => {
		const backup = { ...(await exportBackup()), version: undefined as unknown as number };

		await expect(importBackup(backup)).rejects.toThrow(/verzi/);
	});

	it('refuses a file that is not one of ours', async () => {
		const backup = { format: 'something-else', version: 1 } as unknown as Backup;

		await expect(importBackup(backup)).rejects.toThrow(/téhle aplikace/);
	});

	it('accepts an older backup, treating its missing tables as empty', async () => {
		// A v1 file: the six original tables, and nothing this build added since.
		const old = {
			format: 'finance-backup' as const,
			version: 1,
			exportedAt: '2026-01-01T00:00:00.000Z',
			accounts: [],
			categories: [],
			txns: [],
			dayMarks: [],
			goals: [],
			reconciliations: []
		} as unknown as Backup;

		await expect(importBackup(old)).resolves.toMatchObject({ txns: 0 });
	});
});

describe('importBackup — the merge', () => {
	it('round-trips a reconciliation', async () => {
		const backup = { ...(await exportBackup()), reconciliations: [reconciliation()] };

		await importBackup(backup);

		const stored = await db.reconciliations.toArray();
		expect(stored).toHaveLength(1);
		expect(stored[0]!.date).toBe('2026-08-31');
	});

	it('never un-deletes a row a merge says is alive', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		const alive = await exportBackup(); // captured before the delete

		await deleteTxn(txn.id);

		// The incoming copy is older *and* alive. Neither may resurrect the row.
		await importBackup(alive);

		expect((await db.txns.get(txn.id))?.isDeleted).toBe(true);
	});

	it('lets a newer row win on updatedAt', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		const backup = await exportBackup();

		backup.txns = backup.txns.map((row) => ({
			...row,
			payee: 'Oběd v restauraci',
			updatedAt: '2099-01-01T00:00:00.000Z'
		}));
		await importBackup(backup);

		expect((await db.txns.get(txn.id))?.payee).toBe('Oběd v restauraci');
	});

	it('leaves a newer local row alone when the incoming one is older', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		const backup = await exportBackup();

		backup.txns = backup.txns.map((row) => ({
			...row,
			payee: 'Stará verze',
			updatedAt: '2000-01-01T00:00:00.000Z'
		}));
		await importBackup(backup);

		expect((await db.txns.get(txn.id))?.payee).toBe('Oběd');
	});
});
