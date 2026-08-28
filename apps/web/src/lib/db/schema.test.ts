/**
 * Migrations, exercised the only way that proves anything: build the database
 * at the *old* version, put old-shaped rows in it, then open it with the
 * current code and look at what came out.
 *
 * A released version is already on the phone, so a migration that has only ever
 * run against an empty database has not been tested at all.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';

import { FinanceDb, SCHEMA_VERSION, migrations } from './schema';

/** A database built from the migrations up to `version`, and no further. */
async function openAtVersion(name: string, version: number): Promise<Dexie> {
	const old = new Dexie(name);
	for (const migration of migrations.filter((m) => m.version <= version)) {
		const declared = old.version(migration.version).stores(migration.stores);
		if (migration.upgrade) declared.upgrade(migration.upgrade);
	}
	await old.open();
	return old;
}

const SYNCED = { updatedAt: '2026-08-01T00:00:00.000Z', deviceId: 'old', isDeleted: false };

describe('the migration array', () => {
	it('is ordered, gapless, and starts at 1', () => {
		expect(migrations.map((m) => m.version)).toEqual(
			Array.from({ length: migrations.length }, (_, i) => i + 1)
		);
	});

	it('reports the last entry as the schema version', () => {
		expect(SCHEMA_VERSION).toBe(migrations[migrations.length - 1]!.version);
	});
});

describe('v5 → v6 — Holding.startDate', () => {
	it('backfills from the holding’s earliest reading', async () => {
		const name = `mig-earliest-${Date.now()}`;
		const old = await openAtVersion(name, 5);
		await old.table('holdings').put({
			id: 'h1',
			name: 'Penzijko',
			kind: 'investment',
			currency: 'CZK',
			categoryId: null,
			reminderDays: 90,
			isArchived: false,
			sortOrder: 0,
			...SYNCED
		});
		await old.table('valuations').bulkPut([
			{
				id: 'v2',
				holdingId: 'h1',
				date: '2026-05-17',
				value: 200_000_00,
				note: null,
				createdAt: '2026-05-17T09:00:00.000Z',
				...SYNCED
			},
			{
				id: 'v1',
				holdingId: 'h1',
				date: '2026-03-04',
				value: 100_000_00,
				note: null,
				createdAt: '2026-03-04T09:00:00.000Z',
				...SYNCED
			}
		]);
		old.close();

		const upgraded = new FinanceDb(name);
		const holding = await upgraded.holdings.get('h1');

		// The first of the month of the earliest reading — never later, so it can
		// never claim a contribution the holding might not have received.
		expect(holding?.startDate).toBe('2026-03-01');
		upgraded.close();
	});

	it('falls back to the current month for a holding never valued', async () => {
		const name = `mig-blank-${Date.now()}`;
		const old = await openAtVersion(name, 5);
		await old.table('holdings').put({
			id: 'h2',
			name: 'ETF',
			kind: 'investment',
			currency: 'CZK',
			categoryId: null,
			reminderDays: 30,
			isArchived: false,
			sortOrder: 0,
			...SYNCED
		});
		old.close();

		const upgraded = new FinanceDb(name);
		const holding = await upgraded.holdings.get('h2');

		expect(holding?.startDate).toBe(`${new Date().toISOString().slice(0, 7)}-01`);
		upgraded.close();
	});

	it('leaves every other field alone', async () => {
		const name = `mig-intact-${Date.now()}`;
		const old = await openAtVersion(name, 5);
		await old.table('holdings').put({
			id: 'h3',
			name: 'Spořicí účet',
			kind: 'savings',
			currency: 'CZK',
			categoryId: 'cat-save',
			reminderDays: 7,
			isArchived: false,
			sortOrder: 3,
			...SYNCED
		});
		old.close();

		const upgraded = new FinanceDb(name);
		const holding = await upgraded.holdings.get('h3');

		expect(holding).toMatchObject({
			name: 'Spořicí účet',
			kind: 'savings',
			categoryId: 'cat-save',
			reminderDays: 7,
			sortOrder: 3,
			updatedAt: SYNCED.updatedAt
		});
		upgraded.close();
	});
});

describe('v4 → v5 — Txn.scheduleId', () => {
	it('backfills null rather than leaving the field absent', async () => {
		const name = `mig-sched-${Date.now()}`;
		const old = await openAtVersion(name, 4);
		await old.table('txns').put({
			id: 't1',
			accountId: 'acc',
			date: '2026-07-04',
			amount: -24900,
			categoryId: 'cat',
			payee: 'Oběd',
			note: null,
			transferPairId: null,
			source: 'manual',
			isCleared: false,
			createdAt: '2026-07-04T10:00:00.000Z',
			isOneOff: false,
			owedAmount: null,
			owedBy: null,
			settledByTxnId: null,
			...SYNCED
		});
		old.close();

		const upgraded = new FinanceDb(name);
		const txn = await upgraded.txns.get('t1');

		// `undefined` would make `row.scheduleId === null` answer false for the
		// entire pre-existing ledger, which is the whole reason this backfills.
		expect(txn).toHaveProperty('scheduleId');
		expect(txn?.scheduleId).toBeNull();
		upgraded.close();
	});
});

describe('v6 → v7 — the share of a schedule that comes back', () => {
	it('backfills null on a schedule declared before the field existed', async () => {
		const name = `mig-owed-${Date.now()}`;
		const old = await openAtVersion(name, 6);
		await old.table('schedules').put({
			id: 's1',
			payee: 'Hypotéka',
			categoryId: 'cat-home',
			amount: -32_000_00,
			dayOfMonth: 15,
			startMonth: '2026-01',
			endMonth: '2051-12',
			mode: 'auto',
			lastPostedMonth: '2026-07',
			isArchived: false,
			sortOrder: 0,
			...SYNCED
		});
		old.close();

		const upgraded = new FinanceDb(name);
		const schedule = await upgraded.schedules.get('s1');

		// Absent is not null: `row.owedAmount === null` has to answer true for
		// every schedule that existed before the field did.
		expect(schedule).toHaveProperty('owedAmount');
		expect(schedule?.owedAmount).toBeNull();
		expect(schedule?.owedBy).toBeNull();
		// And the payment itself is untouched.
		expect(schedule).toMatchObject({
			amount: -32_000_00,
			mode: 'auto',
			lastPostedMonth: '2026-07'
		});
		upgraded.close();
	});
});
