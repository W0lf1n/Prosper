/**
 * What the sync layer is doing, for the one screen that shows it.
 *
 * Rule 5: **sync never blocks the UI.** So this is the entire contract between
 * the engine and the app — a cycle runs, writes here, and Settings reads it.
 * Nothing awaits a cycle, and no screen is disabled while one is running.
 *
 * A module-level rune rather than a store: there is exactly one sync engine per
 * app, and the header-versus-scroll-region problem that makes `$store` unsafe
 * outside `<main>` (DECISIONS, 2026-08-24) does not arise if nobody
 * auto-subscribes in the first place.
 */

import { refreshSyncEnabled } from '$lib/db/repo';
import { nowIso } from '$lib/domain/datetime';
import { db } from '$lib/db/schema';
import {
	backoffMs,
	readCursor,
	readSettings,
	syncOnce,
	writeSettings,
	type SyncSettings
} from './engine';

export type SyncState = 'off' | 'idle' | 'running' | 'error';

interface Status {
	state: SyncState;
	/** Rows still waiting to go up. The number that says "not safe yet". */
	pending: number;
	lastSyncedAt: string | null;
	lastError: string | null;
	/** Consecutive failed cycles. Drives the backoff. */
	failures: number;
	cursor: number;
}

const status = $state<Status>({
	state: 'off',
	pending: 0,
	lastSyncedAt: null,
	lastError: null,
	failures: 0,
	cursor: 0
});

export function syncStatus(): Status {
	return status;
}

let settings: SyncSettings | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

async function refreshPending(): Promise<void> {
	status.pending = await db().outbox.count();
}

/** Read what is stored and take up position. Safe to call more than once. */
export async function initSync(): Promise<void> {
	settings = await readSettings();
	await refreshSyncEnabled();
	status.cursor = await readCursor();
	await refreshPending();
	status.state = settings ? 'idle' : 'off';
	if (settings) schedule(0);
}

export async function configure(next: SyncSettings | null): Promise<void> {
	await writeSettings(next);
	await refreshSyncEnabled();
	settings = next;
	status.state = next ? 'idle' : 'off';
	status.failures = 0;
	status.lastError = null;
	await refreshPending();
	if (next) schedule(0);
	else if (timer) clearTimeout(timer);
}

/**
 * Run one cycle now, unless one is already running.
 *
 * Never throws. A caller that wanted to know went and read `status`, and a
 * rejected promise nobody awaited is an unhandled rejection in a service the
 * whole design says is allowed to fail.
 */
export async function syncNow(): Promise<void> {
	if (!settings || running) return;
	running = true;
	status.state = 'running';

	try {
		const outcome = await syncOnce(settings);
		status.failures = 0;
		status.lastError = null;
		status.lastSyncedAt = nowIso();
		status.cursor = outcome.pull.cursor;
		status.state = 'idle';
	} catch (error) {
		status.failures += 1;
		status.lastError = error instanceof Error ? error.message : 'Neznámá chyba';
		status.state = 'error';
	} finally {
		running = false;
		await refreshPending();
		schedule(backoffMs(status.failures));
	}
}

/**
 * The triggers from §10.7: app foreground, connectivity regained, after a write
 * (debounced), and a manual pull.
 *
 * `debounce` is ten seconds because the alternative is a request per keystroke
 * of a five-second entry, and the ledger is not in a hurry.
 */
const AFTER_WRITE_DEBOUNCE_MS = 10_000;

function schedule(delay: number): void {
	if (!settings) return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => void syncNow(), Math.max(delay, AFTER_WRITE_DEBOUNCE_MS));
}

/** Wire the browser events. Returns the teardown. */
export function watchTriggers(): () => void {
	const onOnline = () => void syncNow();
	const onVisible = () => {
		if (document.visibilityState === 'visible') void syncNow();
	};

	window.addEventListener('online', onOnline);
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		window.removeEventListener('online', onOnline);
		document.removeEventListener('visibilitychange', onVisible);
		if (timer) clearTimeout(timer);
	};
}
