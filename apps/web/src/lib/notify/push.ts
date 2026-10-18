/**
 * The channels that reach a closed app — kept in step with the preference.
 *
 * `syncChannels()` is the one entry point. It is called on every launch and
 * whenever Upozornění changes, never awaited by a screen (rule 5), and it
 * converges: whatever was registered last time, afterwards the push
 * subscription and the periodic sync exist exactly when a notice is on and
 * the system has said yes.
 *
 * **Push** is the real one. The sync server keeps a subscription per device
 * and its wake times (`domain/notifications.ts` → `wakeTimes`): the instants,
 * in UTC, at which to send it an empty push. The service worker wakes,
 * reads the ledger, and says whatever is due. Nothing about the ledger
 * travels — the server learns minutes and dates, not payees.
 *
 * **Periodic sync** is the fallback for a device that is not paired. Chrome
 * on Android only, installed only, and at an interval the browser picks —
 * twelve hours asked for, often more given. It will say the evening question
 * late rather than never, and that is all it promises.
 */

import {
	type NotifyKeyResponse,
	type NotifyResponse,
	type NotifySubscribeRequest
} from '@prosper/contracts';
import { getNoticePrefs } from '$lib/db/repo';
import { db } from '$lib/db/schema';
import { today } from '$lib/domain/datetime';
import { anyNoticeOn, wakeTimes } from '$lib/domain/notifications';
import { readSettings, request } from '$lib/sync/engine';
import { PERIODIC_TAG } from './notices';

/**
 * How a notice reaches this phone, as Upozornění explains it.
 *
 * - `off` — nothing is on, or nothing was asked for yet.
 * - `blocked` — the system said no; only the system settings can undo that.
 * - `unsupported` — this browser has no notifications at all.
 * - `server` — the sync server wakes it; on time, closed or not.
 * - `open` — no server: only while the app is open, plus Android's late fallback.
 */
export type Channel = 'off' | 'blocked' | 'unsupported' | 'server' | 'open';

/** Why there is no server channel, when there is not. */
export type ServerGap = 'unpaired' | 'no-keys' | 'offline' | 'no-push' | null;

export interface ChannelState {
	channel: Channel;
	gap: ServerGap;
	/** Chrome's periodic background sync is registered. */
	periodic: boolean;
}

export function notificationsSupported(): boolean {
	return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
}

export function permission(): NotificationPermission | 'unsupported' {
	return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Asked from a tap — browsers refuse a permission prompt nobody asked for. */
export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
	if (!notificationsSupported()) return 'unsupported';
	if (Notification.permission !== 'default') return Notification.permission;
	return Notification.requestPermission();
}

function base64url(buffer: ArrayBuffer | null): string {
	if (!buffer) return '';
	let binary = '';
	for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const padded = text
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(text.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * A local `YYYY-MM-DDTHH:MM` as the UTC instant it is on this phone — the
 * browser's own zone rules, so 21:00 stays 21:00 across a change of clocks.
 */
function utcOf(local: string): string {
	const [date, clock] = local.split('T') as [string, string];
	const [year, month, day] = date.split('-').map(Number) as [number, number, number];
	const [hours, minutes] = clock.split(':').map(Number) as [number, number];
	return new Date(year, month - 1, day, hours, minutes).toISOString();
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
	const own = subscription.options.applicationServerKey;
	if (!own) return false;
	const bytes = new Uint8Array(own);
	return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

interface PeriodicSyncManager {
	register(tag: string, options?: { minInterval: number }): Promise<void>;
	unregister(tag: string): Promise<void>;
}

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

async function syncPeriodic(
	registration: ServiceWorkerRegistration,
	on: boolean
): Promise<boolean> {
	const manager = (
		registration as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }
	).periodicSync;
	if (!manager) return false;
	try {
		if (!on) {
			await manager.unregister(PERIODIC_TAG);
			return false;
		}
		await manager.register(PERIODIC_TAG, { minInterval: TWELVE_HOURS });
		return true;
	} catch {
		// Not installed, or the browser declined: the fallback is a fallback.
		return false;
	}
}

let last: ChannelState = { channel: 'off', gap: null, periodic: false };

/** What the last `syncChannels()` found. */
export function lastChannelState(): ChannelState {
	return last;
}

/**
 * Make the channels match the preference. Never throws: a server that is down
 * leaves the old subscription where it was, and the next launch tries again.
 */
export async function syncChannels(): Promise<ChannelState> {
	last = await converge().catch(() => ({
		channel: 'open' as const,
		gap: 'offline' as const,
		periodic: false
	}));
	return last;
}

async function converge(): Promise<ChannelState> {
	if (!notificationsSupported()) return { channel: 'unsupported', gap: null, periodic: false };

	const prefs = await getNoticePrefs();
	const wanted = anyNoticeOn(prefs);
	const granted = Notification.permission === 'granted';
	const registration = await navigator.serviceWorker.getRegistration();

	if (!registration) {
		// `vite dev` has no worker; the open-tab timer still runs.
		if (wanted && Notification.permission === 'denied') {
			return { channel: 'blocked', gap: null, periodic: false };
		}
		return { channel: wanted ? 'open' : 'off', gap: wanted ? 'no-push' : null, periodic: false };
	}

	const periodic = await syncPeriodic(registration, wanted && granted);
	const existing =
		'pushManager' in registration ? await registration.pushManager.getSubscription() : null;
	const settings = await readSettings();

	if (!wanted || !granted) {
		if (existing) {
			if (settings) {
				await request<NotifyResponse>(settings, '/api/v1/notify/unsubscribe', {
					method: 'POST',
					body: '{}'
				}).catch(() => undefined);
			}
			await existing.unsubscribe().catch(() => false);
		}
		const blocked = wanted && Notification.permission === 'denied';
		return { channel: blocked ? 'blocked' : 'off', gap: null, periodic: false };
	}

	if (!('pushManager' in registration)) return { channel: 'open', gap: 'no-push', periodic };
	if (!settings) return { channel: 'open', gap: 'unpaired', periodic };

	let key: Uint8Array<ArrayBuffer>;
	try {
		const answer = await request<NotifyKeyResponse>(settings, '/api/v1/notify/key');
		key = fromBase64url(answer.publicKey);
	} catch (error) {
		const status = (error as { status?: number }).status ?? 0;
		return { channel: 'open', gap: status === 0 ? 'offline' : 'no-keys', periodic };
	}

	let subscription = existing;
	if (subscription && !sameKey(subscription, key)) {
		// The server's keys changed: a subscription made for the old ones is dead.
		await subscription.unsubscribe().catch(() => false);
		subscription = null;
	}
	subscription ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: key
	});

	const now = Date.now();
	const body: NotifySubscribeRequest = {
		endpoint: subscription.endpoint,
		p256dh: base64url(subscription.getKey('p256dh')),
		auth: base64url(subscription.getKey('auth')),
		wakes: wakeTimes(prefs, await db().schedules.toArray(), today())
			.map(utcOf)
			.filter((instant) => Date.parse(instant) > now)
	};
	await request<NotifyResponse>(settings, '/api/v1/notify/subscribe', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	return { channel: 'server', gap: null, periodic };
}
