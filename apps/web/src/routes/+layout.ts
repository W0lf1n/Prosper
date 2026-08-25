import { browser } from '$app/environment';
import type { LayoutLoad } from './$types';

/**
 * A local-first app has nothing useful to render on a server: the ledger lives
 * in IndexedDB on this device. The build emits a static shell and the app takes
 * over in the browser.
 */
export const ssr = false;
export const prerender = true;

export const load: LayoutLoad = async () => {
	if (!browser) return { accountId: null };

	const { ensureSeeded, closePreviousDay } = await import('$lib/db/repo');
	const { accountId } = await ensureSeeded();

	// Yesterday is over. If the app was open on it and nothing went in, that is a
	// zero rather than a gap — see `closePreviousDay` for why it only ever
	// reaches back one day.
	await closePreviousDay();

	// Ask the browser not to evict the ledger under storage pressure (§12).
	// Chrome grants this silently once the app is installed.
	void navigator.storage?.persist?.().catch(() => undefined);

	return { accountId };
};
