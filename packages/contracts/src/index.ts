/**
 * The sync protocol, as types.
 *
 * This package is the one place the client and the server agree on a shape.
 * The client imports it directly; `apps/api` mirrors it in C#, and the mirror
 * is checked by the round-trip test rather than by hope.
 *
 * It describes `PROJECT-PLAN.md` §10 and nothing else — no domain rules, no
 * money arithmetic, no dates. A type here is a wire format, and a wire format
 * is allowed to be dull.
 */

/** The entity kinds a row can carry. Mirrors `SyncedEntity` in the web app. */
export const SYNCED_ENTITIES = [
	'txn',
	'account',
	'category',
	'goal',
	'monthTarget',
	'reconciliation',
	'dayMark',
	'holding',
	'valuation',
	'schedule'
] as const;

export type SyncedEntity = (typeof SYNCED_ENTITIES)[number];

/**
 * One row, on the wire.
 *
 * The full row travels, never a diff. A diff needs both sides to agree on a
 * base version, which is exactly the thing a last-write-wins merge has decided
 * not to track — and a partial row that loses a race leaves the ledger in a
 * state neither device ever held.
 */
export interface SyncRow {
	entity: SyncedEntity;
	/** The client-generated UUIDv7. The server never assigns one. */
	id: string;
	/** ISO datetime from the authoring device's clock. The LWW key. */
	updatedAt: string;
	/** Ties `updatedAt` collisions, by plain string compare. */
	deviceId: string;
	isDeleted: boolean;
	/** The whole row as the client stores it, minus nothing. */
	payload: unknown;
}

/**
 * A row the server refused, and why.
 *
 * Rejections are per row rather than per batch: one malformed row must not
 * cost the other 499 their trip, and the client needs to know which of its
 * outbox entries to stop retrying.
 */
export interface SyncRejection {
	entity: SyncedEntity;
	id: string;
	reason: 'malformed' | 'unknown-entity' | 'conflict' | 'too-large';
	detail: string;
}

// ── POST /api/v1/pair ───────────────────────────────────────────────────────

export interface PairRequest {
	/** The code shown on an already-paired device, or set on the server. */
	code: string;
	/** Free text, so a device list is readable. */
	deviceName: string;
}

export interface PairResponse {
	deviceId: string;
	/** Bearer token. Device-bound, no expiry short enough to matter offline. */
	token: string;
}

// ── POST /api/v1/sync/push ──────────────────────────────────────────────────

export interface PushRequest {
	changes: SyncRow[];
}

export interface PushResponse {
	/** How many rows were stored or won their merge. */
	applied: number;
	/** How many were older than what the server already held. LWW, not an error. */
	superseded: number;
	rejected: SyncRejection[];
	/** Where the server's log now ends. Not a pull cursor — see `pull`. */
	serverCursor: number;
}

// ── GET /api/v1/sync/pull ───────────────────────────────────────────────────

export interface PullQuery {
	/** Exclusive. `0` is "everything you have". */
	since: number;
	limit: number;
}

export interface PullResponse {
	changes: SyncRow[];
	/** Feed this back as `since` next time. */
	cursor: number;
	hasMore: boolean;
}

// ── GET /api/v1/health ──────────────────────────────────────────────────────

export interface HealthResponse {
	ok: boolean;
	version: string;
}

// ── shared limits ───────────────────────────────────────────────────────────

/** Rows per push. Chosen so one batch fits comfortably in a mobile request. */
export const PUSH_BATCH_SIZE = 200;

/** Rows per pull. §10 names 500. */
export const PULL_PAGE_SIZE = 500;

/**
 * The merge rule, in one function, so client and server cannot drift.
 *
 * Last-write-wins on `updatedAt`, ties broken on `deviceId` string compare.
 * `updatedAt` is a client clock and that is accepted: one person, their own
 * devices, skew measured in seconds.
 *
 * **A delete is never undone by a merge.** If either side says the row is
 * gone, it stays gone — the winner decides every other field.
 */
export function mergeDecision(
	incoming: Pick<SyncRow, 'updatedAt' | 'deviceId'>,
	existing: Pick<SyncRow, 'updatedAt' | 'deviceId'> | null
): 'apply' | 'superseded' {
	if (existing === null) return 'apply';
	if (incoming.updatedAt > existing.updatedAt) return 'apply';
	if (incoming.updatedAt < existing.updatedAt) return 'superseded';
	return incoming.deviceId > existing.deviceId ? 'apply' : 'superseded';
}
