/**
 * The starter categories — Petr's own buckets, lifted from `Výdaje 2026.xlsx`.
 *
 * The spreadsheet used one column pair per bucket: amount and `popis`. That
 * structure is kept, because eight months of use is stronger evidence than any
 * taxonomy this app could invent, and because seven chips fit on one screen —
 * which is the difference between a five-second entry and a ten-second one.
 *
 * Two changes, both flagged in DECISIONS.md:
 *   SPOŘENÍ is new (Q24). In the spreadsheet "dlouhodobá investice" — 2 000 Kč
 *   every month, 16 000 Kč so far — sat inside OSTATNÍ, which means the one
 *   number the Targeting law needs was buried in the dumping ground.
 *
 *   `spendType` is a second axis on top of the buckets, not a replacement.
 *   It is what the need/want split reads. Change any of them in Settings.
 *
 * Since the third edition (2026-09-05) every bucket is a coloured circle with
 * an icon in it. The defaults below are the seed's; the v13 migration hands
 * them to buckets written before the fields existed, by name, and
 * `defaultCategoryStyle` is the one place that lookup lives.
 */

import type { SpendType } from '$lib/domain/types';
import { normalize } from '$lib/domain/vocabulary';

export interface CategorySeed {
	name: string;
	spendType: SpendType;
	isIncome?: boolean;
	/** A name in `Icon.svelte`'s set. */
	icon: string;
	/** A key of the `--cat-*` palette in `tokens.css`. */
	color: string;
}

export function seedCategories(): CategorySeed[] {
	return [
		// Chip order = how often it gets tapped. Groceries and eating out together
		// are ~200 entries over eight months, mostly under 200 Kč; they belong
		// under the thumb.
		//
		// POTRAVINY is split out of BYDLENÍ and JÍDLO deliberately: eating out is
		// the discretionary half, which is why JÍDLO is a `want` and POTRAVINY is
		// a `need`. In the spreadsheet the two were mixed and neither number
		// meant anything.
		{ name: 'POTRAVINY', spendType: 'need', icon: 'shopping-cart', color: 'teal' },
		{ name: 'JÍDLO', spendType: 'want', icon: 'utensils', color: 'orange' },
		{ name: 'BYDLENÍ', spendType: 'need', icon: 'house', color: 'blue' },
		{ name: 'LIFESTYLE', spendType: 'want', icon: 'sparkles', color: 'pink' },
		{ name: 'INVESTICE DO MĚ', spendType: 'save', icon: 'graduation-cap', color: 'yellow' },
		// The book's first allocation: given away, nothing expected back. As a
		// `want` it vanished into the discretionary pile and could not be read.
		{ name: 'DARY', spendType: 'give', icon: 'gift', color: 'cobalt' },
		{ name: 'SPOŘENÍ', spendType: 'save', icon: 'piggy-bank', color: 'green' },
		{ name: 'PROJEKTY', spendType: 'want', icon: 'hammer', color: 'brown' },

		// Last on purpose. OSTATNÍ took 100 895 Kč in eight months — the second
		// biggest bucket in the book. Making it the least convenient chip is the
		// cheapest available fix, and the monthly check watches its share.
		{ name: 'OSTATNÍ', spendType: 'want', icon: 'ellipsis', color: 'stone' },

		{ name: 'PŘÍJEM', spendType: 'save', isIncome: true, icon: 'banknote', color: 'teal' }
	];
}

/** SMĚNA — the bucket an exchange's incoming leg lands in (2026-09-02). */
const EXCHANGE_STYLE = { icon: 'repeat', color: 'cobalt' };

/** Anything the seed does not know: a plain tag on stone. */
const PLAIN_STYLE = { icon: 'tag', color: 'stone' };

/**
 * The style a bucket gets by its name alone — the seed's when the name is one
 * of the seed's, the exchange bucket's for SMĚNA, and the plain tag otherwise.
 * Diacritics and case are ignored, so a renamed "Jídlo" still finds its fork.
 */
export function defaultCategoryStyle(name: string): { icon: string; color: string } {
	const key = normalize(name);
	if (key === 'smena') return EXCHANGE_STYLE;
	const seed = seedCategories().find((c) => normalize(c.name) === key);
	return seed ? { icon: seed.icon, color: seed.color } : PLAIN_STYLE;
}
