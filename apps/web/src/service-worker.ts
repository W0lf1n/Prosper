/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * App shell cache.
 *
 * Offline is the normal case, not the error case (§11.5). Everything the app
 * needs to boot is precached at install; the network is only ever consulted for
 * something the cache does not already hold.
 */

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `prosper-${version}`;
const PRECACHE = [...build, ...files, ...prerendered];

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
