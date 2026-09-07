/**
 * A new build reaches the installed app on its own — Q62.
 *
 * The service worker precaches the shell and takes over the moment it is
 * installed (`skipWaiting`, `clients.claim`), so the one question is *when the
 * browser looks for it*. It looks on a navigation into the worker's scope and
 * at most once a day otherwise — and an installed app that is brought back
 * from the background performs no navigation. It resumes. A phone that keeps
 * Prosper in its recents for a week never asks, which is why a new version
 * used to need a visit to the real browser and a reload there.
 *
 * So the app asks itself: every time it comes back into view, and every time
 * the network comes back, `registration.update()` — one conditional request
 * for `service-worker.js`, byte-compared by the browser, nothing installed
 * unless it changed. When a new worker has taken over (`controllerchange`),
 * the page that is still running the old bundle says so in a toast with
 * *Obnovit*, and reloads by itself on the next navigation — a navigation is
 * the one moment nothing is half-typed. Never in the middle of a screen: a
 * keypad with an amount on it is not to be reloaded under the thumb.
 */

import { toast } from './toast.svelte';

let pending = false;

/**
 * Reload into the new build, if one has taken over. Called from the layout
 * after every navigation, which is the one safe moment for it.
 */
export function applyUpdate(): void {
	if (!pending) return;
	pending = false;
	location.reload();
}

/**
 * Start asking for updates on every resume and reconnect, and announce a
 * worker that has taken over. Returns the teardown.
 */
export function watchUpdates(): () => void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
	const sw = navigator.serviceWorker;

	/* The very first install also fires `controllerchange` — the page went
	   from uncontrolled to controlled — and there is no older bundle to
	   leave behind in that case. */
	let hadController = sw.controller !== null;

	const check = () => {
		if (document.visibilityState !== 'visible') return;
		void sw
			.getRegistration()
			.then((registration) => registration?.update())
			.catch(() => {
				/* Offline, or the server is away: the next resume asks again. */
			});
	};

	const onController = () => {
		if (!hadController) {
			hadController = true;
			return;
		}
		pending = true;
		toast.show('Nová verze je připravená', {
			action: { label: 'Obnovit', run: () => location.reload() },
			ms: 8000
		});
	};

	document.addEventListener('visibilitychange', check);
	window.addEventListener('online', check);
	sw.addEventListener('controllerchange', onController);
	check();

	return () => {
		document.removeEventListener('visibilitychange', check);
		window.removeEventListener('online', check);
		sw.removeEventListener('controllerchange', onController);
	};
}
