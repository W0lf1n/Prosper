/**
 * Upozornění, while the app is open.
 *
 * A timer for the next minute anything could fall due, and a look on every
 * resume. What is due is said in the app when the app is in front of him —
 * a toast with one pill, because a system notice about the screen he is
 * already holding is noise — and as a system notice when the tab is behind
 * something else, which on a desktop is most of the day.
 *
 * On a phone this is the smallest of the three channels (`notices.ts`): a
 * backgrounded app is frozen, and its timers with it. What reaches a closed
 * app is the push from the sync server.
 */

import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { getNoticePrefs } from '$lib/db/repo';
import { db } from '$lib/db/schema';
import { today } from '$lib/domain/datetime';
import {
	eveningNotice,
	msUntilNextCheck,
	postedNotice,
	type Notice
} from '$lib/domain/notifications';
import type { DueItem } from '$lib/domain/recurring';
import { toast } from '$lib/ui/toast.svelte';
import { OPEN_MESSAGE, showNotice, takeDueNotices } from './notices';
import { syncChannels } from './push';

/** Dispatched on `window` by Upozornění after a save. */
export const PREFS_CHANGED = 'prosper:notice-prefs';

/** Let the launch splash play out before anything is said over it. */
const LAUNCH_DELAY_MS = 2500;

/** Two toasts never land on one another; the second waits its turn. */
const TOAST_MS = 7000;

const PILL: Record<Notice['kind'], string> = {
	evening: 'Zapsat',
	auto: 'Výpis',
	awaiting: 'Ukázat'
};

function go(url: Notice['url']): void {
	void goto(resolve(url));
}

function isNoticeUrl(value: unknown): value is Notice['url'] {
	return value === '/' || value === '/zapis' || value === '/vypis';
}

let queued: ReturnType<typeof setTimeout>[] = [];

function sayInApp(notices: readonly Notice[]): void {
	// Two at most: past that, Domů already says the rest.
	notices.slice(0, 2).forEach((notice, index) => {
		const timer = setTimeout(() => {
			toast.show(notice.kind === 'evening' ? `${notice.title} ${notice.body}` : notice.title, {
				action: { label: PILL[notice.kind], run: () => go(notice.url) },
				ms: TOAST_MS
			});
		}, index * TOAST_MS);
		queued.push(timer);
	});
}

async function sayOnSystem(notices: readonly Notice[]): Promise<void> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	const registration = await navigator.serviceWorker?.getRegistration();
	for (const notice of notices) {
		if (registration) await showNotice(registration, notice);
		// `vite dev` has no worker; the plain constructor is enough to see it.
		else new Notification(notice.title, { body: notice.body, tag: notice.tag, lang: 'cs' });
	}
}

/**
 * Vyzkoušet: tonight's question, now, as the system will show it — read
 * from today's real rows. Logs nothing, so the evening still asks it.
 */
export async function previewNotice(): Promise<boolean> {
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
	const day = today();
	const notice = eveningNotice(
		await db().txns.where('date').equals(day).toArray(),
		await db().accounts.toArray(),
		day
	);
	await sayOnSystem([{ ...notice, tag: 'prosper-preview' }]);
	return true;
}

async function deliver(notices: readonly Notice[]): Promise<void> {
	if (notices.length === 0) return;
	if (document.visibilityState === 'visible') sayInApp(notices);
	else await sayOnSystem(notices);
}

/**
 * Start watching. `posted` is what the launch wrote on its own; with the
 * automatic-payment notice on, it is the first thing said. Returns the stop.
 */
export function watchNotices(posted: readonly DueItem[]): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;

	async function check(): Promise<void> {
		if (stopped) return;
		const notices = await takeDueNotices().catch(() => []);
		await deliver(notices);
		await arm();
	}

	async function arm(): Promise<void> {
		clearTimeout(timer);
		if (stopped) return;
		const delay = msUntilNextCheck(await getNoticePrefs(), new Date());
		// setTimeout's ceiling is ~24.8 days; a day is the most this ever asks.
		if (delay !== null) timer = setTimeout(() => void check(), delay);
	}

	async function launch(): Promise<void> {
		const prefs = await getNoticePrefs();
		const notices: Notice[] = [];
		if (prefs.auto) {
			const said = postedNotice(posted, await db().accounts.toArray());
			if (said) notices.push(said);
		}
		notices.push(...(await takeDueNotices().catch(() => [])));
		await deliver(notices);
		await arm();
		// The push subscription and the periodic sync follow the preference.
		void syncChannels();
	}

	const start = setTimeout(() => void launch(), LAUNCH_DELAY_MS);

	function resumed() {
		if (document.visibilityState === 'visible') void check();
	}

	/** A tap on a system notice while a window is open: navigate it, do not reload it. */
	function opened(event: MessageEvent) {
		const data = event.data as { type?: string; url?: unknown } | null;
		if (data?.type === OPEN_MESSAGE && isNoticeUrl(data.url)) go(data.url);
	}

	/** Upozornění changed: the next minute that matters may have moved. */
	function changed() {
		void arm();
	}

	document.addEventListener('visibilitychange', resumed);
	navigator.serviceWorker?.addEventListener('message', opened);
	addEventListener(PREFS_CHANGED, changed);

	return () => {
		stopped = true;
		clearTimeout(start);
		clearTimeout(timer);
		queued.forEach(clearTimeout);
		queued = [];
		document.removeEventListener('visibilitychange', resumed);
		navigator.serviceWorker?.removeEventListener('message', opened);
		removeEventListener(PREFS_CHANGED, changed);
	};
}
