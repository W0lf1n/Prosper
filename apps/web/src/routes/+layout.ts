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

	const { ensureSeeded, catchUpSchedules } = await import('$lib/db/repo');
	const { accountId } = await ensureSeeded();

	// Standing orders do not post themselves while the app is closed — there is
	// no server. They are settled on the way in: `auto` schedules write their
	// rows here, `confirm` ones surface on the entry screen.
	await catchUpSchedules(accountId);

	// Ask the browser not to evict the ledger under storage pressure (§12).
	// Chrome grants this silently once the app is installed.
	void navigator.storage?.persist?.().catch(() => undefined);

	return { accountId };
};
