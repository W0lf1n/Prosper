import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/tape` was Výpis's address until 2026-09-07 (Q65). The address survives for
 * the phone that has it in its history or on its home screen.
 */
export const load: PageLoad = () => {
	redirect(307, '/vypis');
};
