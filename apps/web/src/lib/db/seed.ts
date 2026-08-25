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
 */

import type { SpendType } from '$lib/domain/types';

export interface CategorySeed {
	name: string;
	spendType: SpendType;
	isIncome?: boolean;
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
		{ name: 'POTRAVINY', spendType: 'need' },
		{ name: 'JÍDLO', spendType: 'want' },
		{ name: 'BYDLENÍ', spendType: 'need' },
		{ name: 'LIFESTYLE', spendType: 'want' },
		{ name: 'INVESTICE DO MĚ', spendType: 'save' },
		// The book's first allocation: given away, nothing expected back. As a
		// `want` it vanished into the discretionary pile and could not be read.
		{ name: 'DARY', spendType: 'give' },
		{ name: 'SPOŘENÍ', spendType: 'save' },
		{ name: 'PROJEKTY', spendType: 'want' },

		// Last on purpose. OSTATNÍ took 100 895 Kč in eight months — the second
		// biggest bucket in the book. Making it the least convenient chip is the
		// cheapest available fix, and the monthly check watches its share.
		{ name: 'OSTATNÍ', spendType: 'want' },

		{ name: 'PŘÍJEM', spendType: 'save', isIncome: true }
	];
}
