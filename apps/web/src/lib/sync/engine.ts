/**
 * The sync engine — `PROJECT-PLAN.md` §10.
 *
 * The client is the source of truth for authoring. The server is durable
 * storage and a cross-device merge point, and the app must work with it
 * permanently down. **Nothing in this file is ever awaited by the UI**
 * (rule 5): a cycle runs in the background, writes its outcome to
 * `status.svelte.ts`, and that is the only way the screens hear about it.
 *
 * The cycle is: drain the outbox oldest-first, then pull everything new. Push
 * before pull, always, in one cycle — a device that pulls first would merge a
 * stale copy of a row it is about to overwrite anyway, and spend a round trip
 * doing it.
 *
 * Conflicts never reach here. `mergeDecision` in `@vydaje/contracts` is the
 * rule, it is the same function on both sides, and `applyRemote` uses it for
 * every incoming row.
 */

import {
	PULL_PAGE_SIZE,
	PUSH_BATCH_SIZE,
	mergeDecision,
	type PullResponse,
	type PushResponse,
	type SyncRow,
	type SyncedEntity
} from '@vydaje/contracts';

import { db } from '$lib/db/schema';
import { adoptRemoteLedger, getDeviceId, getMeta, setMeta } from '$lib/db/repo';
import type { OutboxEntry } from '$lib/domain/types';

const META_CURSOR = 'syncCursor';
const META_TOKEN = 'syncToken';
const META_BASE_URL = 'syncBaseUrl';

/** Give up on a row the server keeps refusing, rather than blocking the queue. */
const MAX_ATTEMPTS = 6;

/** Backoff between failed cycles: doubling, capped at five minutes (§10.5). */
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

export interface SyncSettings {
	baseUrl: string;
	token: string;
}

export async function readSettings(): Promise<SyncSettings | null> {
	const [baseUrl, token] = await Promise.all([
		getMeta<string>(META_BASE_URL),
		getMeta<string>(META_TOKEN)
	]);
	return baseUrl && token ? { baseUrl, token } : null;
}

export async function writeSettings(settings: SyncSettings | null): Promise<void> {
	await setMeta(META_BASE_URL, settings?.baseUrl ?? null);
	await setMeta(META_TOKEN, settings?.token ?? null);
}

export async function readCursor(): Promise<number> {
	return (await getMeta<number>(META_CURSOR)) ?? 0;
}

// ── the table each entity lands in ──────────────────────────────────────────

/**
 * Which Dexie table an entity kind belongs to.
 *
 * Explicit rather than derived from a pluralised name: a typo in a string that
 * is built at runtime puts rows in a table nobody reads, and that is the sort
 * of bug that surfaces a month later as one screen disagreeing with another.
 */
const TABLES: Record<SyncedEntity, string> = {
	txn: 'txns',
	account: 'accounts',
	category: 'categories',
	goal: 'goals',
	monthTarget: 'monthTargets',
	reconciliation: 'reconciliations',
	dayMark: 'dayMarks',
	holding: 'holdings',
	valuation: 'valuations',
	schedule: 'schedules'
};

/**
 * `DayMark` is keyed by its date and carries no `id` or `isDeleted`, which is
 * the one place the uniform row shape does not hold. It is handled apart rather
 * than given fields it has no use for.
 */
function isDayMark(entity: SyncedEntity): boolean {
	return entity === 'dayMark';
}

// ── HTTP ────────────────────────────────────────────────────────────────────

class SyncError extends Error {
	constructor(
		message: string,
		readonly status: number,
		/** 4xx is the client's fault and will not fix itself by waiting. */
		readonly permanent: boolean
	) {
		super(message);
		this.name = 'SyncError';
	}
}

async function request<T>(
	settings: SyncSettings,
	path: string,
	init: RequestInit = {}
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}${path}`, {
			...init,
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${settings.token}`,
				...init.headers
			}
		});
	} catch (cause) {
		// Offline is the normal case, not the error case. It is not permanent.
		throw new SyncError(cause instanceof Error ? cause.message : 'Síť není', 0, false);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new SyncError(
			body || response.statusText,
			response.status,
			response.status >= 400 && response.status < 500
		);
	}

	return (await response.json()) as T;
}

// ── push ────────────────────────────────────────────────────────────────────

function rowOf(entry: OutboxEntry, deviceId: string): SyncRow | null {
	const payload = entry.payload as Record<string, unknown> | null;
	if (!payload) return null;

	return {
		entity: entry.entity,
		id: entry.entityId,
		updatedAt: String(payload.updatedAt ?? ''),
		deviceId: String(payload.deviceId ?? deviceId),
		isDeleted: Boolean(payload.isDeleted ?? false),
		payload
	};
}

export interface PushOutcome {
	sent: number;
	applied: number;
	rejected: number;
	/** Entries still queued after this drain. */
	remaining: number;
}

/**
 * Drain the outbox, oldest first, in batches.
 *
 * Oldest first matters: the outbox holds one entry per mutation, so a row
 * edited three times is three entries, and delivering the newest one first
 * would let the older two overwrite it on a server that is applying LWW by
 * `updatedAt`… which it would not, because LWW protects against exactly that.
 * It is still done in order, because a log delivered out of order is a log
 * nobody can read when something goes wrong.
 */
export async function pushOnce(settings: SyncSettings): Promise<PushOutcome> {
	const database = db();
	const deviceId = await getDeviceId();
	const outcome: PushOutcome = { sent: 0, applied: 0, rejected: 0, remaining: 0 };

	for (;;) {
		const batch = await database.outbox.orderBy('seq').limit(PUSH_BATCH_SIZE).toArray();
		if (batch.length === 0) break;

		const rows = batch.map((entry) => rowOf(entry, deviceId));
		const sendable = batch.filter((_, i) => rows[i] !== null);

		let response: PushResponse;
		try {
			response = await request<PushResponse>(settings, '/api/v1/sync/push', {
				method: 'POST',
				body: JSON.stringify({ changes: rows.filter((r): r is SyncRow => r !== null) })
			});
		} catch (error) {
			// The batch stays queued. Attempts are counted so a row the server
			// will never accept cannot block the ones behind it forever.
			const message = error instanceof Error ? error.message : 'Neznámá chyba';
			const permanent = error instanceof SyncError && error.permanent;
			await database.transaction('rw', database.outbox, async () => {
				for (const entry of batch) {
					const attempts = entry.attempts + 1;
					if (permanent && attempts >= MAX_ATTEMPTS) {
						await database.outbox.delete(entry.seq!);
					} else {
						await database.outbox.update(entry.seq!, { attempts, lastError: message });
					}
				}
			});
			throw error;
		}

		const rejected = new Set(response.rejected.map((r) => `${r.entity}:${r.id}`));
		await database.transaction('rw', database.outbox, async () => {
			for (const entry of sendable) {
				const key = `${entry.entity}:${entry.entityId}`;
				if (rejected.has(key)) {
					const detail = response.rejected.find((r) => `${r.entity}:${r.id}` === key);
					// A rejection is permanent by definition — the row is malformed or
					// the server does not know the entity. Retrying cannot help, and
					// leaving it queued blocks everything behind it.
					await database.outbox.delete(entry.seq!);
					outcome.rejected += 1;
					console.warn('[sync] rejected', key, detail?.detail);
					continue;
				}
				await database.outbox.delete(entry.seq!);
			}
			// Entries whose payload could not be turned into a row are corrupt and
			// will never send. Drop them rather than spin.
			for (const entry of batch.filter((e) => !sendable.includes(e))) {
				await database.outbox.delete(entry.seq!);
			}
		});

		outcome.sent += batch.length;
		outcome.applied += response.applied;
		if (batch.length < PUSH_BATCH_SIZE) break;
	}

	outcome.remaining = await database.outbox.count();
	return outcome;
}

// ── pull ────────────────────────────────────────────────────────────────────

export interface PullOutcome {
	received: number;
	applied: number;
	cursor: number;
}

/**
 * Write one incoming row into its table, under the merge rule.
 *
 * The rows that arrive here were authored on another device, so they do **not**
 * go through `repo.ts` — that would re-stamp `updatedAt` with this device's
 * clock and enqueue them straight back out, which is a sync loop with extra
 * steps. This is the one place outside `repo.ts` that writes, and it writes
 * only what the server sent.
 */
async function applyRemote(row: SyncRow): Promise<boolean> {
	const database = db();
	const table = database.table(TABLES[row.entity]);
	if (!table) return false;

	if (isDayMark(row.entity)) {
		const payload = row.payload as { date?: string; updatedAt?: string } | null;
		if (!payload?.date) return false;
		const existing = await table.get(payload.date);
		if (existing && String(existing.updatedAt) >= String(payload.updatedAt ?? '')) return false;
		await table.put(payload);
		return true;
	}

	const existing = (await table.get(row.id)) as
		{ updatedAt: string; deviceId: string; isDeleted: boolean } | undefined;

	if (mergeDecision(row, existing ?? null) === 'superseded') return false;

	// A delete is never undone by a merge (§6.1). The winner decides every other
	// field; `isDeleted` is the one field where either side saying "gone" wins.
	const payload = row.payload as Record<string, unknown>;
	await table.put({
		...payload,
		isDeleted: row.isDeleted || (existing?.isDeleted ?? false)
	});
	return true;
}

export async function pullOnce(settings: SyncSettings): Promise<PullOutcome> {
	const outcome: PullOutcome = { received: 0, applied: 0, cursor: await readCursor() };

	for (;;) {
		const response = await request<PullResponse>(
			settings,
			`/api/v1/sync/pull?since=${outcome.cursor}&limit=${PULL_PAGE_SIZE}`
		);

		for (const row of response.changes) {
			outcome.received += 1;
			if (await applyRemote(row)) outcome.applied += 1;
		}

		outcome.cursor = response.cursor;
		// The cursor is persisted per page, not per cycle: a connection that dies
		// halfway through a long backfill must not start over.
		await setMeta(META_CURSOR, outcome.cursor);

		if (!response.hasMore) break;
	}

	/**
	 * Run after every pull, not only at pairing.
	 *
	 * Pairing two devices in quick succession is a race the protocol cannot
	 * order: the first one has only *queued* its seed when the second one pairs,
	 * so the second pulls an empty ledger, sees no reason to give up its own
	 * account, and both seeds go up. The result is two accounts, and each device
	 * showing an empty tape while holding the other's rows.
	 *
	 * Deciding this on every pull instead makes the timing irrelevant — the
	 * moment the other device's account actually arrives, whenever that is, the
	 * still-untouched device stands down. It costs three counts and returns
	 * immediately in every other case.
	 */
	await adoptRemoteLedger();

	return outcome;
}

// ── one cycle ───────────────────────────────────────────────────────────────

export interface CycleOutcome {
	push: PushOutcome;
	pull: PullOutcome;
}

/** Push, then pull. Throws only what the caller should show. */
export async function syncOnce(settings: SyncSettings): Promise<CycleOutcome> {
	const push = await pushOnce(settings);
	const pull = await pullOnce(settings);
	return { push, pull };
}

/** How long to wait after `failures` consecutive failed cycles. */
export function backoffMs(failures: number): number {
	if (failures <= 0) return 0;
	return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]!;
}

export { SyncError, MAX_ATTEMPTS };
