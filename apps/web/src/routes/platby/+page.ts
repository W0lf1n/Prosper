import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/platby` became the second half of `/prehled` in the third edition. The
 * address survives for the phone that has it in its history.
 */
export const load: PageLoad = () => {
	redirect(307, '/prehled?tab=platby');
};
