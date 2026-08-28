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
	createGoal,
	createHolding,
	createTxn,
	deleteTxn,
	ensureSeeded,
	exportBackup,
	getCollapsedMonths,
	importBackup,
	recordValuation,
	resetLedger,
	setCollapsedMonths,
	updateAccount,
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

/**
 * The wipe. It is the only place in the app that touches every table at once,
 * and the only one where getting it wrong is unrecoverable for the person
 * holding the phone — so what it spares is asserted as hard as what it clears.
 */
describe('resetLedger', () => {
	it('flags every recorded row and counts what it flagged', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		await createTxn({ accountId, amount: -11000 as Minor, payee: 'Kafe' });
		const goal = await createGoal({
			name: 'Rezerva',
			why: 'Abych nemusel řešit každou rozbitou pračku půjčkou.',
			targetAmount: 100000 as Minor,
			targetDate: '2027-01-31'
		});
		const holding = await createHolding({ name: 'Penzijko', kind: 'investment' });
		await recordValuation({ holdingId: holding.id, value: 50000 as Minor });

		const result = await resetLedger();

		expect(result.txns).toBe(2);
		expect(result.goals).toBe(1);
		expect(result.holdings).toBe(1);
		expect(result.valuations).toBe(1);

		expect((await db.txns.toArray()).every((t) => t.isDeleted)).toBe(true);
		expect((await db.goals.get(goal.id))?.isDeleted).toBe(true);
		expect((await db.holdings.get(holding.id))?.isDeleted).toBe(true);
		expect((await db.valuations.toArray()).every((v) => v.isDeleted)).toBe(true);
	});

	it('soft-deletes — nothing is actually removed (§13.2)', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });

		await resetLedger();

		const row = await db.txns.get(txn.id);
		expect(row).toBeDefined();
		expect(row?.payee).toBe('Oběd');
		expect(row?.amount).toBe(-24900);
	});

	it('keeps the categories, which are configuration rather than history', async () => {
		const before = await db.categories.count();
		expect(before).toBeGreaterThan(0);

		await resetLedger();

		const live = (await db.categories.toArray()).filter((c) => !c.isDeleted);
		expect(live).toHaveLength(before);
	});

	it('keeps the account but forgets what it opened at', async () => {
		await updateAccount(accountId, { openingBalance: 500000 as Minor, openingDate: '2026-01-01' });

		await resetLedger();

		const account = await db.accounts.get(accountId);
		expect(account?.isDeleted).toBe(false);
		expect(account?.name).toBe('Běžný účet');
		expect(account?.openingBalance).toBe(0);
	});

	it('counts a row only once, however many times it is run', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });

		expect((await resetLedger()).txns).toBe(1);
		expect((await resetLedger()).txns).toBe(0);
	});

	it('leaves the ledger exportable, so the backup taken before it still merges back', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		const backup = await exportBackup();

		await resetLedger();
		expect((await db.txns.toArray()).every((t) => t.isDeleted)).toBe(true);

		// A restore is last-write-wins and a delete is never un-set by a merge
		// (§13.2) — so the rows come back only if the backup is newer, which is
		// exactly what a fresh import of an older file must *not* do.
		await importBackup(backup);
		expect((await db.txns.toArray()).every((t) => t.isDeleted)).toBe(true);
	});
});

describe('the folded months on /vypis', () => {
	it('starts with nothing folded', async () => {
		expect(await getCollapsedMonths()).toEqual([]);
	});

	it('round-trips the set it was given', async () => {
		await setCollapsedMonths(['2026-01', '2026-02']);

		expect(await getCollapsedMonths()).toEqual(['2026-01', '2026-02']);
	});

	it('shrugs off a stored value it does not recognise', async () => {
		await db.meta.put({ key: 'tapeCollapsedMonths', value: 'nonsense' });

		expect(await getCollapsedMonths()).toEqual([]);
	});
});
