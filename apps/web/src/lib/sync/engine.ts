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
 * Conflicts never reach here. `mergeDecision` in `@prosper/contracts` is the
 * rule, it is the same function on both sides, and `applyRemotePage` uses it for
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
} from '@prosper/contracts';

import { db } from '$lib/db/schema';
import { adoptRemoteLedger, getDeviceId, getMeta, setMeta } from '$lib/db/repo';
import { checkRow } from '$lib/domain/rows';
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

/**
 * Store the pairing, and reset the cursor with it.
 *
 * The cursor is a sequence number in **one server's** numbering and means
 * nothing anywhere else. Carrying it across a re-pair is how a phone asks
 * `?since=4211` of a database whose highest sequence is 0, receives nothing,
 * and shows an empty ledger while both sides report success — which is exactly
 * what the restore in `DEPLOYMENT.md` does to every device.
 *
 * So it is cleared whenever the pairing changes identity: unpairing, and
 * pairing against an address or token that is not the one already stored.
 */
export async function writeSettings(settings: SyncSettings | null): Promise<void> {
	const current = await readSettings();
	const sameServer =
		settings !== null &&
		current !== null &&
		current.baseUrl === settings.baseUrl &&
		current.token === settings.token;

	await setMeta(META_BASE_URL, settings?.baseUrl ?? null);
	await setMeta(META_TOKEN, settings?.token ?? null);
	if (!sameServer) await setMeta(META_CURSOR, 0);
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
		/**
		 * The row will never be accepted, so retrying it is pointless and
		 * dropping it is safe. **Malformed only** — see `REJECTING` below.
		 */
		readonly permanent: boolean
	) {
		super(message);
		this.name = 'SyncError';
	}

	/** The queue is fine; this device's credentials are not. */
	get unauthorized(): boolean {
		return this.status === 401 || this.status === 403;
	}
}

/**
 * The statuses that mean "this row is wrong", as opposed to "you are not
 * allowed" or "the server is unwell".
 *
 * The distinction is the difference between dropping a mutation and keeping
 * it. A 401 after a token is revoked, or after the server database is restored
 * from `backup.sh`, says nothing at all about the rows in the outbox — they are
 * the only copy of work the user has done, and draining the queue over an
 * authentication problem loses it silently.
 */
const REJECTING = new Set([400, 409, 413, 422]);

/**
 * A cycle is never in a hurry, but it must not hang.
 *
 * A `fetch` to a host that accepts the connection and then drops the packets
 * never settles on its own, and a pinned promise here means `running` stays
 * true and no further cycle is ever scheduled.
 */
const REQUEST_TIMEOUT_MS = 30_000;

async function request<T>(
	settings: SyncSettings,
	path: string,
	init: RequestInit = {}
): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}${path}`, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
			REJECTING.has(response.status)
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
			//
			// **An authentication failure never counts.** A revoked token or a
			// restored server database says nothing about these rows, and the
			// outbox is the only copy of the work in it: counting 401s toward
			// MAX_ATTEMPTS empties the queue about a minute after a token stops
			// working, and the user is never told what they lost. It is surfaced
			// as an error and left alone until somebody re-pairs.
			const message = error instanceof Error ? error.message : 'Neznámá chyba';
			if (error instanceof SyncError && error.unauthorized) throw error;

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
	/** Rows the server sent that `checkRow` would not let in. Logged, never stored. */
	skipped: number;
	cursor: number;
}

/**
 * Why an incoming row may not be written, or null.
 *
 * The server checked the envelope — entity, id, updatedAt, deviceId, a payload
 * that is an object and not too big. Nobody had checked the row *inside* it.
 * One `amount: "abc"` from a device running an older build, or from a database
 * restored by hand, made `money.ts` throw inside every live query and every
 * screen showed a ledger of zeros. `domain/rows.ts` is the check; this adds
 * the one thing only the envelope can say — that the row is the row it claims
 * to be, because `bulkPut` keys on the payload's own `id`.
 */
function refusal(row: SyncRow): string | null {
	const problem = checkRow(row.entity, row.payload);
	if (problem) return problem;
	if (!isDayMark(row.entity) && (row.payload as { id: string }).id !== row.id) {
		return 'payload id does not match the envelope';
	}
	return null;
}

/**
 * Write one page of incoming rows into their tables, under the merge rule.
 *
 * The rows that arrive here were authored on another device, so they do **not**
 * go through `repo.ts` — that would re-stamp `updatedAt` with this device's
 * clock and enqueue them straight back out, which is a sync loop with extra
 * steps. This is the one place outside `repo.ts` that writes, and it writes
 * only what the server sent.
 *
 * A **page** rather than a row, because a page is what IndexedDB is good at.
 * Row at a time meant two implicit transactions per row, each with its own
 * commit — five hundred rows was a thousand transactions on the main thread,
 * and a first pull after pairing is several thousand rows. Now it is one
 * `bulkGet`, the merge decided in memory, and one `bulkPut` per table, inside a
 * single transaction: the same decision for every row, one commit for the page.
 */
async function applyRemotePage(rows: SyncRow[]): Promise<{ applied: number; skipped: number }> {
	if (rows.length === 0) return { applied: 0, skipped: 0 };

	const database = db();
	let skipped = 0;

	// Grouped by table, because `bulkGet`/`bulkPut` are per table and the merge
	// needs the existing row that shares the incoming one's key.
	const byTable = new Map<string, SyncRow[]>();
	for (const row of rows) {
		// A row that would not survive the domain does not get in. The cursor
		// still moves past it — the server keeps it, this device declines it,
		// and the console says which one and why.
		const problem = refusal(row);
		if (problem) {
			console.warn('[sync] skipped', `${row.entity}:${row.id}`, problem);
			skipped += 1;
			continue;
		}
		const name = TABLES[row.entity];
		if (!name) continue;
		const group = byTable.get(name);
		if (group) group.push(row);
		else byTable.set(name, [row]);
	}
	if (byTable.size === 0) return { applied: 0, skipped };

	let applied = 0;

	await database.transaction('rw', [...byTable.keys()], async () => {
		for (const [name, group] of byTable) {
			const table = database.table(name);

			// `dayMark` is keyed by its date and carries no `id`; every other
			// entity is keyed by the row id the client generated.
			const keyOf = (row: SyncRow): string | null =>
				isDayMark(row.entity) ? ((row.payload as { date?: string } | null)?.date ?? null) : row.id;

			const keyed = group.filter((row) => keyOf(row) !== null);
			if (keyed.length === 0) continue;

			const existing = await table.bulkGet(keyed.map((row) => keyOf(row)!));

			// The last write for a key wins within the page too, so a key that
			// appears twice is merged against the winner rather than both copies
			// racing into the same `bulkPut`.
			const winners = new Map<string, unknown>();
			const merged = new Map<string, { updatedAt: string; deviceId: string; isDeleted: boolean }>();

			for (let i = 0; i < keyed.length; i += 1) {
				const row = keyed[i]!;
				const key = keyOf(row)!;
				const before = (merged.get(key) ?? existing[i]) as
					{ updatedAt: string; deviceId: string; isDeleted: boolean } | undefined;

				if (isDayMark(row.entity)) {
					const payload = row.payload as { date?: string; updatedAt?: string };
					if (before && String(before.updatedAt) >= String(payload.updatedAt ?? '')) continue;
					winners.set(key, payload);
					merged.set(key, {
						updatedAt: String(payload.updatedAt ?? ''),
						deviceId: '',
						isDeleted: false
					});
					applied += 1;
					continue;
				}

				if (mergeDecision(row, before ?? null) === 'superseded') continue;

				// A delete is never undone by a merge (§6.1). The winner decides
				// every other field; `isDeleted` is the one field where either side
				// saying "gone" wins.
				const isDeleted = row.isDeleted || (before?.isDeleted ?? false);
				const payload = row.payload as Record<string, unknown>;
				winners.set(key, { ...payload, isDeleted });
				merged.set(key, { updatedAt: row.updatedAt, deviceId: row.deviceId, isDeleted });
				applied += 1;
			}

			if (winners.size > 0) await table.bulkPut([...winners.values()]);
		}
	});

	return { applied, skipped };
}

export async function pullOnce(settings: SyncSettings): Promise<PullOutcome> {
	const outcome: PullOutcome = { received: 0, applied: 0, skipped: 0, cursor: await readCursor() };

	for (;;) {
		const response = await request<PullResponse>(
			settings,
			`/api/v1/sync/pull?since=${outcome.cursor}&limit=${PULL_PAGE_SIZE}`
		);

		outcome.received += response.changes.length;
		const page = await applyRemotePage(response.changes);
		outcome.applied += page.applied;
		outcome.skipped += page.skipped;

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
