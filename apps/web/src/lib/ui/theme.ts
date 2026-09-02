/**
 * Theme preference.
 *
 * The one thing allowed in localStorage (§11.8) — it has to be readable
 * synchronously before first paint, and it is not domain data.
 */

import { syncThemeColor } from './tint';

export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'theme';

export function readTheme(): Theme {
	if (typeof localStorage === 'undefined') return 'system';
	const value = localStorage.getItem(THEME_KEY);
	return value === 'light' || value === 'dark' ? value : 'system';
}

export function applyTheme(theme: Theme): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	if (theme === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', theme);
	/* The ground the currency tint resolved to just moved with the theme, and
	   the status bar has to follow it (Q50). */
	syncThemeColor();

	if (typeof localStorage !== 'undefined') {
		if (theme === 'system') localStorage.removeItem(THEME_KEY);
		else localStorage.setItem(THEME_KEY, theme);
	}
}
