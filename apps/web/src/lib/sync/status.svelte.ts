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

import { refreshSyncEnabled, setOutboxListener } from '$lib/db/repo';
import { nowIso } from '$lib/domain/datetime';
import { db } from '$lib/db/schema';
import {
	SyncError,
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
	setOutboxListener(syncAfterWrite);
	settings = await readSettings();
	await refreshSyncEnabled();
	status.cursor = await readCursor();
	await refreshPending();
	status.state = settings ? 'idle' : 'off';
	// Coming to the foreground is a trigger (§10.7), and app start is the first
	// one of those, so this is debounced rather than left to the idle floor.
	if (settings) schedule(0, AFTER_WRITE_DEBOUNCE_MS);
}

export async function configure(next: SyncSettings | null): Promise<void> {
	await writeSettings(next);
	await refreshSyncEnabled();
	settings = next;
	status.state = next ? 'idle' : 'off';
	status.failures = 0;
	status.lastError = null;
	await refreshPending();
	if (next) schedule(0, AFTER_WRITE_DEBOUNCE_MS);
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
		// A 401/403 is the one failure a person can act on, and the outbox is
		// deliberately kept intact through it (`pushOnce`). Say what to do.
		status.lastError =
			error instanceof SyncError && error.unauthorized
				? 'Server tohle zařízení nezná. Spáruj ho znovu.'
				: error instanceof Error
					? error.message
					: 'Neznámá chyba';
		status.state = 'error';
	} finally {
		running = false;
		await refreshPending();
		// Failed: the backoff ladder, as written, with no floor over it.
		// Succeeded: nothing is waiting, so the next cycle is the idle safety
		// net rather than a ten-second poll.
		schedule(backoffMs(status.failures), status.failures > 0 ? 0 : IDLE_POLL_MS);
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

/**
 * The floor under an *idle* cycle, which is a different number entirely.
 *
 * These two were one constant, and the debounce won: every successful cycle
 * scheduled the next one ten seconds later, so a paired device with the app
 * open ran a full push-pull-adopt cycle every ten seconds forever — some
 * 8 600 requests a day from a phone whose ledger changes a handful of times.
 * Nothing asked for that; it was the debounce leaking into the resting state.
 *
 * §10.7's triggers are the events, and they still fire immediately. This is
 * only the safety net under them, for the changes another device pushed while
 * this one sat open and untouched.
 */
const IDLE_POLL_MS = 15 * 60_000;

/**
 * Wake up in `delay` ms, never sooner than `floor`.
 *
 * The floor is passed rather than assumed, because the three callers want
 * three different ones: a trigger is debounced, a failed cycle honours the
 * backoff ladder (§10.5) exactly, and an idle re-arm waits a quarter of an hour.
 */
function schedule(delay: number, floor: number): void {
	if (!settings) return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => void syncNow(), Math.max(delay, floor));
}

/**
 * The trigger §10.7 names and the app never actually had: a write happened.
 *
 * Debounced, because a five-second entry is several writes and the ledger is
 * not in a hurry. This is what lets the idle floor be a quarter of an hour
 * without anything waiting a quarter of an hour — the moment something is
 * genuinely queued, the cycle is ten seconds away.
 */
export function syncAfterWrite(): void {
	if (!settings || running) return;
	schedule(0, AFTER_WRITE_DEBOUNCE_MS);
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
