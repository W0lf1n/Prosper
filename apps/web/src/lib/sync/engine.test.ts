/**
 * The outbox drain against a mock API — the integration test `PROJECT-PLAN.md`
 * §13 asks for: happy path, 4xx, 5xx, offline mid-flush, duplicate push.
 *
 * `fetch` is stubbed rather than a server being started. What is being tested
 * is the client's decisions — what it queues, what it retries, what it gives up
 * on, and what it never un-deletes — and none of those need a socket.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullResponse, PushResponse, SyncRow } from '@prosper/contracts';

import type { Minor } from '$lib/domain/money';
import {
	adoptRemoteLedger,
	createTxn,
	deleteTxn,
	ensureSeeded,
	getActiveAccountId,
	getDeviceId,
	refreshSyncEnabled,
	seedOutbox,
	setMeta
} from '$lib/db/repo';
import { FinanceDb, setDb } from './../db/schema';
import { SyncError, backoffMs, pullOnce, pushOnce, readCursor, syncOnce } from './engine';

const SETTINGS = { baseUrl: 'https://example.test', token: 'tok' };

let db: FinanceDb;
let accountId: string;
let counter = 0;

/** Queue of canned responses, consumed in order. */
let responses: Array<() => Promise<Response> | Response>;
let requests: Array<{ url: string; body: unknown }>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const emptyPull = (cursor = 0): PullResponse => ({ changes: [], cursor, hasMore: false });

beforeEach(async () => {
	counter += 1;
	db = new FinanceDb(`sync-${counter}-${Date.now()}`);
	setDb(db);
	({ accountId } = await ensureSeeded());

	// Pairing is what turns the outbox on.
	await setMeta('syncBaseUrl', SETTINGS.baseUrl);
	await refreshSyncEnabled();

	responses = [];
	requests = [];
	vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
		requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
		const next = responses.shift();
		if (!next) return Promise.resolve(json(emptyPull()));
		return Promise.resolve(next());
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const pushOk = (applied: number, extra: Partial<PushResponse> = {}) =>
	json({ applied, superseded: 0, rejected: [], serverCursor: applied, ...extra });

describe('pushOnce — the happy path', () => {
	it('sends what is queued and empties the outbox', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = [() => pushOk(1)];

		const outcome = await pushOnce(SETTINGS);

		expect(outcome.applied).toBe(1);
		expect(outcome.remaining).toBe(0);
		expect(await db.outbox.count()).toBe(0);
	});

	it('sends the whole row, never a diff', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = [() => pushOk(1)];

		await pushOnce(SETTINGS);

		const [row] = (requests[0]!.body as { changes: SyncRow[] }).changes;
		expect(row).toMatchObject({ entity: 'txn', id: txn.id, isDeleted: false });
		expect((row!.payload as { payee: string }).payee).toBe('Oběd');
	});

	it('carries a soft delete as a row, not as an absence', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		await deleteTxn(txn.id);
		responses = [() => pushOk(2)];

		await pushOnce(SETTINGS);

		const sent = (requests[0]!.body as { changes: SyncRow[] }).changes;
		expect(sent).toHaveLength(2);
		expect(sent[1]!.isDeleted).toBe(true);
	});
});

describe('pushOnce — when the server says no', () => {
	it('keeps the batch queued and counts the attempt on a 5xx', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = [() => json({ error: 'boom' }, 500)];

		await expect(pushOnce(SETTINGS)).rejects.toThrow(SyncError);

		const [entry] = await db.outbox.toArray();
		expect(entry?.attempts).toBe(1);
		expect(entry?.lastError).toBeTruthy();
		expect(await db.outbox.count()).toBe(1);
	});

	it('keeps the batch queued when the network is simply gone', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = [
			() => {
				throw new TypeError('Failed to fetch');
			}
		];

		await expect(pushOnce(SETTINGS)).rejects.toMatchObject({ permanent: false });
		expect(await db.outbox.count()).toBe(1);
	});

	it('eventually drops a row a 4xx will never accept, rather than blocking the queue', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = Array.from({ length: 10 }, () => () => json({ error: 'nope' }, 400));

		for (let i = 0; i < 6; i += 1) {
			await pushOnce(SETTINGS).catch(() => undefined);
		}

		// A row nobody will ever accept must not hold the ledger hostage.
		expect(await db.outbox.count()).toBe(0);
	});

	it('drops a row the server rejected by name and keeps the rest', async () => {
		const a = await createTxn({ accountId, amount: -100 as Minor, payee: 'A' });
		await createTxn({ accountId, amount: -200 as Minor, payee: 'B' });
		responses = [
			() =>
				pushOk(1, {
					rejected: [{ entity: 'txn', id: a.id, reason: 'malformed', detail: 'bad' }]
				})
		];

		const outcome = await pushOnce(SETTINGS);

		expect(outcome.rejected).toBe(1);
		expect(await db.outbox.count()).toBe(0);
	});
});

describe('pushOnce — duplicates', () => {
	it('re-pushing the same row is harmless: the server reports it superseded', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = [() => pushOk(0, { superseded: 1 })];

		const outcome = await pushOnce(SETTINGS);

		expect(outcome.applied).toBe(0);
		// Superseded is not an error. The row is on the server; the queue is done.
		expect(await db.outbox.count()).toBe(0);
	});
});

describe('pullOnce', () => {
	function remote(id: string, payee: string, updatedAt: string): SyncRow {
		return {
			entity: 'txn',
			id,
			updatedAt,
			deviceId: 'other',
			isDeleted: false,
			payload: {
				id,
				accountId,
				date: '2026-08-20',
				amount: -55000,
				categoryId: null,
				payee,
				note: null,
				transferPairId: null,
				source: 'manual',
				isCleared: false,
				createdAt: updatedAt,
				isOneOff: false,
				owedAmount: null,
				owedBy: null,
				settledByTxnId: null,
				scheduleId: null,
				updatedAt,
				deviceId: 'other',
				isDeleted: false
			}
		};
	}

	it('writes an incoming row into its own table', async () => {
		responses = [
			() =>
				json({
					changes: [remote('r1', 'Večeře', '2026-08-20T10:00:00.000Z')],
					cursor: 7,
					hasMore: false
				})
		];

		const outcome = await pullOnce(SETTINGS);

		expect(outcome.applied).toBe(1);
		expect((await db.txns.get('r1'))?.payee).toBe('Večeře');
		expect(await readCursor()).toBe(7);
	});

	it('does not re-enqueue what it just pulled — that would be a sync loop', async () => {
		responses = [
			() =>
				json({
					changes: [remote('r1', 'Večeře', '2026-08-20T10:00:00.000Z')],
					cursor: 7,
					hasMore: false
				})
		];

		await pullOnce(SETTINGS);

		expect(await db.outbox.count()).toBe(0);
	});

	it('lets the newer side win, whichever side it is', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Místní' });
		responses = [
			() =>
				json({
					changes: [remote(txn.id, 'Vzdálený', '2099-01-01T00:00:00.000Z')],
					cursor: 2,
					hasMore: false
				})
		];

		await pullOnce(SETTINGS);

		expect((await db.txns.get(txn.id))?.payee).toBe('Vzdálený');
	});

	it('keeps the local row when the incoming one is older', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Místní' });
		responses = [
			() =>
				json({
					changes: [remote(txn.id, 'Vzdálený', '2000-01-01T00:00:00.000Z')],
					cursor: 2,
					hasMore: false
				})
		];

		await pullOnce(SETTINGS);

		expect((await db.txns.get(txn.id))?.payee).toBe('Místní');
	});

	it('never un-deletes a row, even from a newer remote copy', async () => {
		const txn = await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		await deleteTxn(txn.id);
		responses = [
			() =>
				json({
					changes: [remote(txn.id, 'Zpět', '2099-01-01T00:00:00.000Z')],
					cursor: 3,
					hasMore: false
				})
		];

		await pullOnce(SETTINGS);

		// The winner decides every other field; `isDeleted` is the one where
		// either side saying "gone" wins for good (§6.1).
		const stored = await db.txns.get(txn.id);
		expect(stored?.isDeleted).toBe(true);
		expect(stored?.payee).toBe('Zpět');
	});

	it('follows the pages, saving the cursor as it goes', async () => {
		responses = [
			() =>
				json({
					changes: [remote('r1', 'A', '2026-08-01T00:00:00.000Z')],
					cursor: 1,
					hasMore: true
				}),
			() =>
				json({
					changes: [remote('r2', 'B', '2026-08-02T00:00:00.000Z')],
					cursor: 2,
					hasMore: false
				})
		];

		const outcome = await pullOnce(SETTINGS);

		expect(outcome.received).toBe(2);
		expect(await readCursor()).toBe(2);
	});
});

describe('a whole cycle', () => {
	it('pushes before it pulls', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });
		responses = [() => pushOk(1), () => json(emptyPull(4))];

		await syncOnce(SETTINGS);

		expect(requests[0]!.url).toContain('/sync/push');
		expect(requests[1]!.url).toContain('/sync/pull');
	});

	it('sends the whole ledger the first time a device is paired', async () => {
		// Rows written before pairing are not in the outbox — nothing was queued,
		// because nothing was paired. Without the backfill the server would learn
		// only about rows written afterwards.
		await db.outbox.clear();
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Starý' });
		await db.outbox.clear();

		await seedOutbox();

		const queued = await db.outbox.toArray();
		expect(queued.some((e) => e.entity === 'account')).toBe(true);
		expect(queued.some((e) => e.entity === 'category')).toBe(true);
		expect(queued.some((e) => e.entity === 'txn')).toBe(true);
	});

	it('refuses to backfill twice', async () => {
		await createTxn({ accountId, amount: -24900 as Minor, payee: 'Oběd' });

		expect(await seedOutbox()).toBe(0);
	});
});

describe('adoptRemoteLedger — joining a ledger that already exists', () => {
	/** An account that arrived from the other device: older id, not our deviceId. */
	async function remoteAccount(id = '01a00000-0000-7000-8000-000000000000') {
		await db.accounts.put({
			id,
			name: 'Běžný účet',
			kind: 'checking',
			openingBalance: 0 as Minor,
			openingDate: '2026-01-01',
			currency: 'CZK',
			isArchived: false,
			sortOrder: 0,
			updatedAt: '2026-01-01T00:00:00.000Z',
			deviceId: 'other-device',
			isDeleted: false
		});
		return id;
	}

	it('does nothing while this is the only device', async () => {
		expect(await adoptRemoteLedger()).toBeNull();
	});

	it('gives up a seed account this device never wrote into', async () => {
		const mine = await getActiveAccountId();
		const theirs = await remoteAccount();

		const adopted = await adoptRemoteLedger();

		expect(adopted).toBe(theirs);
		expect(await getActiveAccountId()).toBe(theirs);
		expect((await db.accounts.get(mine!))?.isDeleted).toBe(true);
	});

	it('keeps an account this device has actually recorded into', async () => {
		const mine = await getActiveAccountId();
		await createTxn({ accountId: mine!, amount: -24900 as Minor, payee: 'Oběd' });
		await remoteAccount();

		// Two accounts with real rows is a question for a human, not a guess.
		expect(await adoptRemoteLedger()).toBeNull();
		expect((await db.accounts.get(mine!))?.isDeleted).toBe(false);
	});

	it('is not fooled by transactions that arrived from the other device', async () => {
		// The pull lands first, so the database is not empty by the time this
		// runs. Counting rows rather than *authorship* is what made the first
		// version of this never fire.
		const mine = await getActiveAccountId();
		const theirs = await remoteAccount();
		await db.txns.put({
			id: 'remote-txn',
			accountId: theirs,
			date: '2026-08-20',
			amount: -55000 as Minor,
			categoryId: null,
			payee: 'Jejich',
			note: null,
			transferPairId: null,
			source: 'manual',
			isCleared: false,
			createdAt: '2026-08-20T10:00:00.000Z',
			isOneOff: false,
			owedAmount: null,
			owedBy: null,
			settledByTxnId: null,
			scheduleId: null,
			updatedAt: '2026-08-20T10:00:00.000Z',
			deviceId: 'other-device',
			isDeleted: false
		});

		expect(await adoptRemoteLedger()).toBe(theirs);
		expect((await db.accounts.get(mine!))?.isDeleted).toBe(true);
	});

	it('drops this device’s duplicate buckets and keeps the older ones', async () => {
		await remoteAccount();
		const deviceId = await getDeviceId();
		const before = (await db.categories.toArray()).filter((c) => !c.isDeleted).length;

		// The same starter set, authored earlier, from the other device.
		for (const mine of await db.categories.toArray()) {
			await db.categories.put({
				...mine,
				id: `01a00000-0000-7000-8000-${mine.id.slice(-12)}`,
				deviceId: 'other-device',
				updatedAt: '2026-01-01T00:00:00.000Z'
			});
		}

		await adoptRemoteLedger();

		const live = (await db.categories.toArray()).filter((c) => !c.isDeleted);
		expect(live).toHaveLength(before);
		expect(live.every((c) => c.deviceId === 'other-device')).toBe(true);
		expect(live.some((c) => c.deviceId === deviceId)).toBe(false);
	});

	it('queues the tombstones it creates, so the other device hears about them', async () => {
		await remoteAccount();
		await db.outbox.clear();

		await adoptRemoteLedger();

		const queued = await db.outbox.toArray();
		expect(queued.some((e) => e.entity === 'account')).toBe(true);
	});
});

describe('backoffMs', () => {
	it('is zero while nothing is failing', () => {
		expect(backoffMs(0)).toBe(0);
	});

	it('doubles, and stops at five minutes', () => {
		expect(backoffMs(1)).toBe(5_000);
		expect(backoffMs(3)).toBe(45_000);
		expect(backoffMs(5)).toBe(300_000);
		expect(backoffMs(50)).toBe(300_000);
	});
});
