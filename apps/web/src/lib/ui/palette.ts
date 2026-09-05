/**
 * The palette, as keys — and how a row turns into a coloured circle.
 *
 * A category carries `icon` and `color` since schema v13. Both are *names*:
 * the colour is a key into the ten `--cat-*` tokens in `tokens.css`, never a
 * hex, so the value lives in one file and both themes read it; the icon is a
 * name in `Icon.svelte`'s set. A row written by an older build — an old
 * backup merged in, an unpaired device pushing after an update — may carry
 * neither, so nothing reads the fields directly: `categoryStyle()` is the
 * accessor, and it falls back the way the v13 migration did.
 *
 * Accounts and holdings have no stored colour. An account's is its currency's
 * — the home currency is the accent, the others take a hue each — and a
 * holding's is its kind. Both are derivations, so both live here.
 */

import type { Category, Holding } from '$lib/domain/types';
import { defaultCategoryStyle } from '$lib/db/seed';
import { isIconName, type IconName } from './Icon.svelte';

export const CATEGORY_COLORS = [
	'teal',
	'orange',
	'blue',
	'pink',
	'yellow',
	'cobalt',
	'green',
	'brown',
	'stone',
	'red'
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

/** The icons the editor offers. A subset of what `Icon.svelte` draws. */
export const CATEGORY_ICONS: IconName[] = [
	'shopping-cart',
	'utensils',
	'coffee',
	'house',
	'zap',
	'wifi',
	'car',
	'bus',
	'fuel',
	'sparkles',
	'shirt',
	'gift',
	'heart',
	'piggy-bank',
	'wallet',
	'banknote',
	'graduation-cap',
	'book-open',
	'dumbbell',
	'stethoscope',
	'pill',
	'hammer',
	'wrench',
	'laptop',
	'smartphone',
	'plane',
	'film',
	'music',
	'dog',
	'baby',
	'ellipsis',
	'tag'
];

export interface CategoryStyle {
	icon: IconName;
	color: CategoryColor;
}

export function isCategoryColor(value: string): value is CategoryColor {
	return (CATEGORY_COLORS as readonly string[]).includes(value);
}

/** The CSS value for a palette key. */
export function colorVar(color: CategoryColor): string {
	return `var(--cat-${color})`;
}

/**
 * What a category looks like — its stored style when it has one, the seed
 * default for its name otherwise, and the plain tag on stone for anything
 * unknown. Never throws on a row it does not recognise.
 */
export function categoryStyle(
	category: Pick<Category, 'name' | 'icon' | 'color'> | null | undefined
): CategoryStyle {
	if (!category) return { icon: 'tag', color: 'stone' };
	const fallback = defaultCategoryStyle(category.name);
	const icon = category.icon && isIconName(category.icon) ? category.icon : fallback.icon;
	const color = category.color && isCategoryColor(category.color) ? category.color : fallback.color;
	return { icon: icon as IconName, color: color as CategoryColor };
}

/** An account's colour: the accent at home, a hue of its own abroad. */
export function accountColor(currency: string, home: string): CategoryColor {
	if (currency === home) return 'cobalt';
	switch (currency) {
		case 'EUR':
			return 'teal';
		case 'USD':
			return 'blue';
		case 'GBP':
			return 'pink';
		default:
			return 'stone';
	}
}

/** A holding's colour is its kind. */
export function holdingColor(kind: Holding['kind']): CategoryColor {
	switch (kind) {
		case 'investment':
			return 'green';
		case 'savings':
			return 'yellow';
		case 'crypto':
			return 'orange';
		default:
			return 'stone';
	}
}

/**
 * The short code in a holding's circle: "ETF" for a word that is already an
 * abbreviation, "Pe" for a name — enough to tell two rows apart at a glance.
 */
export function shortCode(name: string): string {
	const first = name.trim().split(/\s+/)[0] ?? '';
	if (!first) return '·';
	if (first.length <= 3 && first === first.toLocaleUpperCase('cs')) return first;
	return first.slice(0, 1).toLocaleUpperCase('cs') + first.slice(1, 2).toLocaleLowerCase('cs');
}
