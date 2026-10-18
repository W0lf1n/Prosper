/**
 * Upozornění, the client half — the part both the page and the service
 * worker run.
 *
 * `domain/notifications.ts` decides what is due at a minute. This reads the
 * device's own ledger for it, moves the log past what it hands back, and
 * draws a notice. It is imported by `service-worker.ts` as well as by the
 * page, so it touches IndexedDB and the Notifications API and nothing else:
 * no `window`, no `document`, no Svelte.
 *
 * Three ways in, one answer:
 *
 * 1. **A push from the sync server** (`push.ts`) — the only one that reaches
 *    a closed app on time. Needs a paired device and a server with VAPID keys.
 * 2. **Periodic background sync** — Chrome on Android, installed app only,
 *    at intervals the browser chooses. Late, but it needs no server.
 * 3. **A timer in an open tab** (`watch.ts`) — a desktop, or the app left open.
 *
 * All three call `takeDueNotices`, and the log it writes is what stops a
 * notice from being said twice when two of them wake at once.
 */

import { getNoticeLog, getNoticePrefs, setNoticeLog } from '$lib/db/repo';
import { db } from '$lib/db/schema';
import { toIsoDate } from '$lib/domain/datetime';
import { dueNotices, minuteOfDay, type Notice } from '$lib/domain/notifications';

/** The periodic-sync registration's name. */
export const PERIODIC_TAG = 'prosper-notices';

/** A tap on a notice tells an open page where to go, rather than reloading it. */
export const OPEN_MESSAGE = 'prosper:open';

/**
 * How far ahead of its minute a push may count a notice as due. The server
 * sends on its clock, the phone judges on its own, and a phone a few seconds
 * slow would otherwise wake at 20:59:50, find nothing due, and leave the
 * browser to show a blank notice of its own in its place.
 */
export const PUSH_LEEWAY_MINUTES = 5;

/**
 * What is due now, with the log already moved past it — so whoever calls
 * this owns showing the result. Only today's rows are read: the evening
 * question needs nothing older, and the date index makes it one lookup.
 * `leeway` lets a wake that was scheduled for a minute count as that minute.
 */
export async function takeDueNotices(now: Date = new Date(), leeway = 0): Promise<Notice[]> {
	const today = toIsoDate(now);
	const database = db();
	const [prefs, log, txns, schedules, accounts] = await Promise.all([
		getNoticePrefs(),
		getNoticeLog(),
		database.txns.where('date').equals(today).toArray(),
		database.schedules.toArray(),
		database.accounts.toArray()
	]);

	const plan = dueNotices({
		prefs,
		log,
		today,
		// Capped at 23:59, so a leeway never reaches into tomorrow's date.
		minute: Math.min(24 * 60 - 1, minuteOfDay(now) + leeway),
		txns,
		schedules,
		accounts
	});
	if (plan.notices.length > 0) await setNoticeLog(plan.log);
	return plan.notices;
}

/**
 * The app's own icon. No `badge`: Android draws it as a white silhouette in
 * the status bar, and a full-bleed icon would be a white square there.
 */
const ICON = '/icon-192.png';

export function showNotice(registration: ServiceWorkerRegistration, notice: Notice): Promise<void> {
	return registration.showNotification(notice.title, {
		body: notice.body,
		tag: notice.tag,
		icon: ICON,
		lang: 'cs',
		data: { url: notice.url }
	});
}
