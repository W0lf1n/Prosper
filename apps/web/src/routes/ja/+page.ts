import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/ja` was the hub in front of Nastavení for two days of the third edition
 * (Q61). The address survives for the phone that has it in its history.
 */
export const load: PageLoad = () => {
	redirect(307, '/nastaveni');
};
