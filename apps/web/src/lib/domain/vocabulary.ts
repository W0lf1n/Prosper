/**
 * The words Petr actually uses.
 *
 * Every keyword here was taken from `Výdaje 2026.xlsx` — eight months of real
 * entries. This is what lets the app say "tohle vypadá na jídlo" instead of
 * asking him to be more careful.
 *
 * Pure data plus string matching. No I/O (§11.6).
 */

/** Fold case and strip diacritics so "JÍDLO", "jidlo" and "Jídlo" all match. */
export function normalize(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

export interface BucketVocabulary {
	/** Category name as seeded. Matching is by normalized name. */
	bucket: string;
	/** Words that, seen in a description, point at this bucket. */
	keywords: string[];
}

export const VOCABULARY: BucketVocabulary[] = [
	{
		bucket: 'JÍDLO',
		keywords: [
			'obed',
			'svacina',
			'vecere',
			'snidane',
			'kafe',
			'kava',
			'cafe',
			'pivo',
			'birell',
			'dzus',
			'piti',
			'restaurace',
			'bistro',
			'mcdonald',
			'kfc',
			'pizza',
			'bageta',
			'zmrzlina'
		]
	},
	{
		bucket: 'BYDLENÍ',
		keywords: [
			'najem',
			'hypo',
			'hypoteka',
			'plyn',
			'elektrina',
			'voda',
			'internet',
			'sluzby',
			'druzstvo',
			'spravce',
			'kotel',
			'domacnost'
		]
	},
	{
		// Split out of BYDLENÍ and JÍDLO on 2026-08-23 (Q23). In the spreadsheet
		// groceries hid inside housing — 27 rows called "jídlo" plus the Rohlík
		// deliveries — so neither the food number nor the housing number meant
		// anything.
		bucket: 'POTRAVINY',
		keywords: [
			'rohlik',
			'nakup',
			'potraviny',
			'drogerie',
			'lidl',
			'albert',
			'billa',
			'kaufland',
			'tesco',
			'penny',
			'globus',
			'makro'
		]
	},
	{
		bucket: 'LIFESTYLE',
		keywords: [
			'netflix',
			'spotify',
			'hbo',
			'prime',
			'icloud',
			'claude',
			'chatgpt',
			'contabo',
			'vps',
			'predplatne',
			'bolt',
			'uber',
			'car4way',
			'taxi'
		]
	},
	{
		bucket: 'DARY',
		keywords: ['kytka', 'kyti', 'darek', 'dysko', 'narozeniny', 'vyroci', 'dort', 'sbirka']
	},
	{
		bucket: 'INVESTICE DO MĚ',
		keywords: [
			'kniha',
			'knihy',
			'kurz',
			'skoleni',
			'holic',
			'obleceni',
			'leky',
			'lekarna',
			'doktor'
		]
	},
	{
		bucket: 'SPOŘENÍ',
		keywords: ['investice', 'sporeni', 'dluhopis', 'fond', 'penzijko', 'rezerva']
	},
	{
		bucket: 'PŘÍJEM',
		keywords: ['vyplata', 'mzda', 'd3s', 'sporak', 'uroky', 'bonus', 'faktura']
	}
];

const INDEX: { keyword: string; bucket: string }[] = VOCABULARY.flatMap((entry) =>
	entry.keywords.map((keyword) => ({ keyword, bucket: normalize(entry.bucket) }))
).sort((a, b) => b.keyword.length - a.keyword.length);

/**
 * Which bucket does this description look like it belongs to?
 * Returns the normalized bucket name, or null when nothing matches.
 */
export function suggestBucket(description: string): string | null {
	const text = normalize(description);
	if (!text) return null;
	for (const { keyword, bucket } of INDEX) {
		if (wordIn(text, keyword)) return bucket;
	}
	return null;
}

/** Whole-word-ish containment: "obed" matches "obed s kolegy" but not "obedvat". */
function wordIn(haystack: string, needle: string): boolean {
	let from = 0;
	for (;;) {
		const at = haystack.indexOf(needle, from);
		if (at === -1) return false;
		const before = at === 0 ? ' ' : haystack[at - 1]!;
		const after = haystack[at + needle.length] ?? ' ';
		if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
		from = at + 1;
	}
}

/**
 * Descriptions that record nothing.
 *
 * Taken verbatim from the spreadsheet: "opak. obj" carried 17 074 Kč in a single
 * month and explains none of it.
 */
const VAGUE = [
	'objednavka',
	'opak obj',
	'opak. obj',
	'opak',
	'nakup',
	'jidlo',
	'veci',
	'ostatni',
	'ruzne',
	'platba',
	'obj'
];

export function isVagueDescription(description: string): boolean {
	const text = normalize(description).replace(/[.,;:]/g, '');
	if (text.length === 0) return true;
	if (text.length < 3) return true;
	return VAGUE.some((v) => text === normalize(v).replace(/[.,;:]/g, ''));
}

/**
 * Numbers mentioned in a description, in minor units.
 *
 * "Netflix - 379" with an amount of 74 Kč means the description is carrying the
 * full price while the amount is one share. That is not wrong, but it is
 * unrecorded — nothing in the sheet says who owes the rest.
 */
export function numbersIn(description: string): number[] {
	const matches = description.matchAll(/(?<![\w,.])(\d{1,3}(?:[\u00a0 ]\d{3})+|\d{2,7})(?![\w])/g);
	return [...matches].map((m) => Number(m[1]!.replace(/[\u00a0 ]/g, '')) * 100);
}
