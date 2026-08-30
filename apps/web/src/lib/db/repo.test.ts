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

import { monthKey, today } from '$lib/domain/datetime';
import type { Minor } from '$lib/domain/money';
import type { Reconciliation } from '$lib/domain/types';
import {
	BACKUP_VERSION,
	catchUpGoalTargets,
	confirmScheduled,
	createAccount,
	createGoal,
	createHolding,
	createSchedule,
	createTransfer,
	createTxn,
	deleteTxn,
	ensureSeeded,
	exportBackup,
	getCollapsedMonths,
	importBackup,
	pinGoal,
	recordValuation,
	resetLedger,
	restoreTxn,
	setCollapsedMonths,
	settleReceivable,
	unsettleReceivable,
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

/**
 * Settling a share writes a second row and links the two, which is exactly the
 * kind of two-table fact the pure layer cannot assert — so it is tested here,
 * against real (fake) persistence, like the backup is.
 */
describe('shares — one expense, several payers (Q47)', () => {
	it('settles one share without touching its neighbour', async () => {
		const netflix = await createTxn({
			accountId,
			amount: -39900 as Minor,
			payee: 'Netflix',
			shares: [
				{ who: 'Kerhy', amount: 13300 as Minor },
				{ who: 'Zůza', amount: 13300 as Minor }
			]
		});
		const kerhy = netflix.shares[0]!;

		const repayment = await settleReceivable(netflix.id, kerhy.id);

		expect(repayment?.amount).toBe(13300);
		expect(repayment?.payee).toBe('vrácení — Kerhy');

		const after = await db.txns.get(netflix.id);
		expect(after?.shares[0]?.settledByTxnId).toBe(repayment!.id);
		expect(after?.shares[1]?.settledByTxnId).toBeNull();
	});

	it('keeps at most ten payers on one expense', async () => {
		const crowd = Array.from({ length: 12 }, (_, i) => ({
			who: `osoba ${i + 1}`,
			amount: 100 as Minor
		}));
		const txn = await createTxn({
			accountId,
			amount: -39900 as Minor,
			payee: 'Netflix',
			shares: crowd
		});
		expect(txn.shares).toHaveLength(10);
		expect(txn.shares[9]?.who).toBe('osoba 10');

		const schedule = await createSchedule({
			accountId,
			payee: 'Netflix',
			categoryId: 'cat',
			amount: -39900 as Minor,
			dayOfMonth: 5,
			shares: crowd
		});
		expect(schedule.shares).toHaveLength(10);
	});

	it('refuses to settle the same share twice', async () => {
		const txn = await createTxn({
			accountId,
			amount: -39900 as Minor,
			payee: 'Netflix',
			shares: [{ who: 'Kerhy', amount: 13300 as Minor }]
		});
		const share = txn.shares[0]!;

		expect(await settleReceivable(txn.id, share.id)).toBeDefined();
		expect(await settleReceivable(txn.id, share.id)).toBeUndefined();
	});

	it('unsettle removes the inflow and reopens only that share', async () => {
		const txn = await createTxn({
			accountId,
			amount: -39900 as Minor,
			payee: 'Netflix',
			shares: [
				{ who: 'Kerhy', amount: 13300 as Minor },
				{ who: 'Zůza', amount: 13300 as Minor }
			]
		});
		const [kerhy, zuza] = txn.shares;
		const repayKerhy = await settleReceivable(txn.id, kerhy!.id);
		const repayZuza = await settleReceivable(txn.id, zuza!.id);

		await unsettleReceivable(txn.id, kerhy!.id);

		const after = await db.txns.get(txn.id);
		expect(after?.shares[0]?.settledByTxnId).toBeNull();
		expect(after?.shares[1]?.settledByTxnId).toBe(repayZuza!.id);
		expect((await db.txns.get(repayKerhy!.id))?.isDeleted).toBe(true);
		expect((await db.txns.get(repayZuza!.id))?.isDeleted).toBe(false);
	});

	it('confirmScheduled copies the declared shares onto the posted row, with fresh ids', async () => {
		const schedule = await createSchedule({
			accountId,
			payee: 'Netflix',
			categoryId: 'cat',
			amount: -39900 as Minor,
			dayOfMonth: 5,
			startMonth: '2026-08',
			shares: [
				{ who: 'Kerhy', amount: 13300 as Minor },
				{ who: 'Zůza', amount: 13300 as Minor }
			]
		});

		const posted = await confirmScheduled(
			{ schedule, month: '2026-08', date: '2026-08-05' },
			{ accountId }
		);

		expect(posted.shares.map((s) => [s.who, s.amount, s.settledByTxnId])).toEqual([
			['Kerhy', 13300, null],
			['Zůza', 13300, null]
		]);
		// Fresh ids: settling August's Kerhy must not implicate September's.
		expect(posted.shares.map((s) => s.id)).not.toContain(schedule.shares[0]!.id);
	});

	it('a settled legacy row is upgraded to the array shape on the way through', async () => {
		// A row as an old build left it — the trio, no array. It can arrive via
		// an old backup or an old device's push long after the migration ran.
		const legacy = {
			id: 'legacy-txn',
			accountId,
			date: '2026-08-15',
			amount: -250000 as Minor,
			categoryId: null,
			payee: 'plyn',
			note: null,
			transferPairId: null,
			source: 'manual',
			isCleared: false,
			isOneOff: false,
			owedAmount: 125000,
			owedBy: 'Zůza',
			settledByTxnId: null,
			scheduleId: null,
			createdAt: '2026-08-15T10:00:00.000Z',
			updatedAt: '2026-08-15T10:00:00.000Z',
			deviceId: 'old-device',
			isDeleted: false
		};
		await db.txns.put(legacy as never);

		const repayment = await settleReceivable('legacy-txn', 'legacy');

		expect(repayment?.amount).toBe(125000);
		const after = await db.txns.get('legacy-txn');
		expect(after?.shares).toEqual([
			{ id: 'legacy', who: 'Zůza', amount: 125000, settledByTxnId: repayment!.id }
		]);
	});
});

/**
 * Transfers write to two accounts at once, which is exactly the kind of fact
 * only persistence can prove — like the settle flow above.
 */
describe('transfers — two accounts, one movement (Q49)', () => {
	async function secondAccount() {
		return createAccount({ name: 'Revolut', kind: 'checking', currency: 'EUR' });
	}

	it('writes two mutually-referencing legs, each in its own account', async () => {
		const revolut = await secondAccount();

		const transfer = await createTransfer({
			fromAccountId: accountId,
			toAccountId: revolut.id,
			amountOut: 2470_00 as Minor,
			amountIn: 100_00 as Minor,
			date: '2026-08-30'
		});

		expect(transfer.out.accountId).toBe(accountId);
		expect(transfer.out.amount).toBe(-2470_00);
		expect(transfer.in.accountId).toBe(revolut.id);
		expect(transfer.in.amount).toBe(100_00);
		// Mutually referencing (§6.1): each leg names the other.
		expect(transfer.out.transferPairId).toBe(transfer.in.id);
		expect(transfer.in.transferPairId).toBe(transfer.out.id);
		// No bucket, ever — a transfer is not spending.
		expect(transfer.out.categoryId).toBeNull();
		expect(transfer.in.categoryId).toBeNull();
	});

	it('refuses a transfer onto the same account', async () => {
		await expect(
			createTransfer({
				fromAccountId: accountId,
				toAccountId: accountId,
				amountOut: 100_00 as Minor,
				amountIn: 100_00 as Minor
			})
		).rejects.toThrow(/dva různé účty/);
	});

	it('deleting one leg takes the pair, and the undo brings back both', async () => {
		const revolut = await secondAccount();
		const transfer = await createTransfer({
			fromAccountId: accountId,
			toAccountId: revolut.id,
			amountOut: 500_00 as Minor,
			amountIn: 500_00 as Minor
		});

		await deleteTxn(transfer.out.id);
		expect((await db.txns.get(transfer.out.id))?.isDeleted).toBe(true);
		expect((await db.txns.get(transfer.in.id))?.isDeleted).toBe(true);

		await restoreTxn(transfer.out.id);
		expect((await db.txns.get(transfer.out.id))?.isDeleted).toBe(false);
		expect((await db.txns.get(transfer.in.id))?.isDeleted).toBe(false);
	});

	it('a schedule posts to its own account, wherever the active one points', async () => {
		const revolut = await secondAccount();
		const schedule = await createSchedule({
			accountId: revolut.id,
			payee: 'Spotify',
			categoryId: 'cat',
			amount: -299_00 as Minor,
			dayOfMonth: 5,
			startMonth: '2026-08'
		});

		// Confirmed while the *other* account is active — the schedule wins.
		const posted = await confirmScheduled(
			{ schedule, month: '2026-08', date: '2026-08-05' },
			{ accountId }
		);
		expect(posted.accountId).toBe(revolut.id);
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

/** The goal fixture the two blocks below share. Valid, and always in future. */
async function aGoal(name = 'Rezerva', targetDate = '2027-06-30') {
	return createGoal({
		name,
		why: 'Abych nemusel řešit každou rozbitou pračku půjčkou.',
		targetAmount: 120000 as Minor,
		targetDate
	});
}

describe('pinGoal', () => {
	it('starts with nothing on screen by choice', async () => {
		const goal = await aGoal();

		expect(goal.isPinned).toBe(false);
	});

	it('is exclusive — one strip, one pin', async () => {
		const first = await aGoal('Rezerva');
		const second = await aGoal('Dovolená');

		await pinGoal(first.id);
		await pinGoal(second.id);

		expect((await db.goals.get(first.id))?.isPinned).toBe(false);
		expect((await db.goals.get(second.id))?.isPinned).toBe(true);
	});

	it('hands the choice back when nothing is pinned', async () => {
		const goal = await aGoal();
		await pinGoal(goal.id);

		await pinGoal(null);

		expect((await db.goals.get(goal.id))?.isPinned).toBe(false);
	});

	it('leaves a goal it did not have to change alone', async () => {
		const goal = await aGoal();
		await pinGoal(goal.id);
		const stamped = (await db.goals.get(goal.id))!.updatedAt;

		await pinGoal(goal.id);

		expect((await db.goals.get(goal.id))?.updatedAt).toBe(stamped);
	});
});

/**
 * The month writes its own number now. What is worth pinning down is the two
 * things it must never do: overwrite a figure set by hand, and invent one for a
 * month that is already over.
 */
describe('catchUpGoalTargets', () => {
	it('writes this month for a goal that has none', async () => {
		const goal = await aGoal();

		expect(await catchUpGoalTargets()).toBe(1);

		const written = await db.monthTargets.where({ goalId: goal.id }).toArray();
		expect(written).toHaveLength(1);
		expect(written[0]!.month).toBe(monthKey(today()));
		expect(written[0]!.amount).toBeGreaterThan(0);
	});

	it('is a no-op the second time — an override survives every launch', async () => {
		const goal = await aGoal();
		await catchUpGoalTargets();
		const first = (await db.monthTargets.where({ goalId: goal.id }).first())!;

		expect(await catchUpGoalTargets()).toBe(0);

		const after = (await db.monthTargets.where({ goalId: goal.id }).first())!;
		expect(after.id).toBe(first.id);
		expect(after.amount).toBe(first.amount);
	});

	it('writes only the current month, never a past one', async () => {
		await aGoal();
		await catchUpGoalTargets();

		const months = (await db.monthTargets.toArray()).map((t) => t.month);
		expect(months).toEqual([monthKey(today())]);
	});

	it('leaves a goal that is already reached alone', async () => {
		const goal = await createGoal({
			name: 'Skoro doma',
			why: 'Abych nemusel řešit každou rozbitou pračku půjčkou.',
			targetAmount: 10000 as Minor,
			targetDate: '2027-06-30'
		});
		const saving = (await db.categories.toArray()).find((c) => c.spendType === 'save')!;
		await createTxn({
			accountId,
			amount: -10000 as Minor,
			categoryId: saving.id,
			payee: 'Odloženo'
		});

		await catchUpGoalTargets();

		expect(await db.monthTargets.where({ goalId: goal.id }).count()).toBe(0);
	});

	it('has nothing to do without a goal', async () => {
		expect(await catchUpGoalTargets()).toBe(0);
	});
});
