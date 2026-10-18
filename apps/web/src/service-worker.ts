/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * App shell cache — and, since 2026-10-18, the voice of Upozornění.
 *
 * Offline is the normal case, not the error case (§11.5). Everything the app
 * needs to boot is precached at install; the network is only ever consulted for
 * something the cache does not already hold.
 */

import { build, files, prerendered, version } from '$service-worker';
import {
	OPEN_MESSAGE,
	PERIODIC_TAG,
	PUSH_LEEWAY_MINUTES,
	showNotice,
	takeDueNotices
} from '$lib/notify/notices';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `prosper-${version}`;
/* Both icon sets and both manifests sit in `static/`; each build caches only
   its own (Q74). `__DEMO__` is the build-time literal from `vite.config.ts`. */
const OWN_FILES = files.filter((file) =>
	__DEMO__
		? !/\/(?:icon(?:-maskable)?-\d+\.png|manifest\.webmanifest)$/.test(file)
		: !file.includes('-demo')
);
const PRECACHE = [...build, ...OWN_FILES, ...prerendered];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	/**
	 * The sync server answers on this origin — that is the whole point of the
	 * deployment in `deploy/` — so "same origin" stopped meaning "an app asset"
	 * the day the client and the API became one nginx.
	 *
	 * Letting a pull through here is wrong twice over. Every distinct `since=`
	 * is a new permanent cache entry holding a page of the ledger, which is the
	 * storage pressure that gets IndexedDB evicted; and offline, a stale page
	 * would be served as a fresh `200`, so the cursor would advance against old
	 * rows and the sync status would report a success that never happened.
	 * A cached `/api/v1/health` would likewise let `probe()` bless a dead server.
	 *
	 * The protocol has its own offline story: the outbox. It does not want ours.
	 */
	if (url.pathname.startsWith('/api/')) return;

	event.respondWith(respond(request, url));
});

/**
 * Upozornění (`lib/notify/`). A push from the sync server carries nothing —
 * it is a wake-up at a minute the phone asked for — and a periodic sync is
 * the browser's own wake-up. Either way the worker reads this device's ledger
 * and says whatever is due, through the same function the open page uses, so
 * the log they share keeps every notice a once.
 */
async function announce(leeway = 0): Promise<void> {
	const notices = await takeDueNotices(new Date(), leeway).catch(() => []);
	await Promise.all(notices.map((notice) => showNotice(sw.registration, notice)));
}

sw.addEventListener('push', (event) => {
	event.waitUntil(announce(PUSH_LEEWAY_MINUTES));
});

// Chromium only, and missing from the DOM typings — hence the string type.
sw.addEventListener('periodicsync', (event: Event) => {
	const wake = event as ExtendableEvent & { tag?: string };
	if (wake.tag === PERIODIC_TAG) wake.waitUntil(announce());
});

/**
 * A tap opens the app where the notice points. An open window is focused and
 * told where to go, so a half-typed amount is not reloaded away.
 */
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const path = String((event.notification.data as { url?: string } | null)?.url ?? '/');
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const open = windows[0];
			if (open) {
				await open.focus();
				open.postMessage({ type: OPEN_MESSAGE, url: path });
				return;
			}
			await sw.clients.openWindow(path);
		})()
	);
});

async function respond(request: Request, url: URL): Promise<Response> {
	const cache = await caches.open(CACHE);

	// Hashed build assets and static files never change under the same name.
	if (PRECACHE.includes(url.pathname)) {
		const hit = await cache.match(url.pathname);
		if (hit) return hit;
	}

	try {
		const response = await fetch(request);
		if (response.ok && response.type === 'basic') {
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const hit = await cache.match(request);
		if (hit) return hit;

		// A navigation with nothing cached for that exact URL still gets the app.
		if (request.mode === 'navigate') {
			const shell = await cache.match('/');
			if (shell) return shell;
		}

		return new Response('Offline', { status: 503, statusText: 'Offline' });
	}
}
