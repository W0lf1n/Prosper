/**
 * The room takes the colour of the currency being written — Q50.
 *
 * Every screen follows the account the keypad writes to, so the one fact
 * worth knowing on all of them is *which currency that is*. The ground says
 * it: the home currency is the graphite the app has always been, and any
 * other currency shifts the ground's hue at the same lightness. Nothing on
 * the ground changes — cards are raised by luminance, ink and data colours
 * are defined against surfaces — so the tint is a temperature of the room,
 * never a colour of anything in it. The values live in `tokens.css` under
 * `[data-currency]`; this module only decides which attribute the root
 * carries and keeps the browser's own chrome in step with it.
 *
 * Automatic, not a setting: "not home" is the whole message, and a control
 * for a decision the app can make is a control too many.
 */

import { CURRENCIES } from '$lib/domain/money';

const ATTRIBUTE = 'data-currency';

/**
 * The attribute value for an active currency, or `null` for the neutral
 * ground — the home currency, an unknown code, or nothing active yet.
 */
export function currencyTint(currency: string | null | undefined, home: string): string | null {
	if (!currency || currency === home) return null;
	return (CURRENCIES as readonly string[]).includes(currency) ? currency : null;
}

/** Sets or clears the root attribute the tokens key on, then tells the
    browser chrome. Safe to call before there is a document. */
export function applyCurrencyTint(code: string | null): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	if (code) root.setAttribute(ATTRIBUTE, code);
	else root.removeAttribute(ATTRIBUTE);
	syncThemeColor();
}

let untinted: string[] | null = null;

/**
 * The status bar follows the ground.
 *
 * `app.html` carries one `theme-color` per scheme, as literals, because a
 * meta tag cannot read a custom property. Tinted, both are pointed at the
 * ground the tokens resolved to — read off the root, so the number is still
 * written in one place — and restored to their own literals when the tint
 * goes. Called again whenever the theme moves, from `applyTheme` and from the
 * layout's media listener, because the resolved ground moves with it.
 */
export function syncThemeColor(): void {
	if (typeof document === 'undefined') return;
	const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
	if (metas.length === 0) return;
	untinted ??= metas.map((meta) => meta.content);

	if (!document.documentElement.hasAttribute(ATTRIBUTE)) {
		metas.forEach((meta, i) => (meta.content = untinted![i]!));
		return;
	}
	const ground = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
	if (ground) metas.forEach((meta) => (meta.content = ground));
}
