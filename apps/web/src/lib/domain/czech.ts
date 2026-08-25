/**
 * Czech plurals.
 *
 * Czech has three: 1 záznam, 2–4 záznamy, 5+ záznamů. Getting this wrong makes
 * an app read like a machine translation, and this one is supposed to sound
 * like it knows what it is talking about.
 */

export interface PluralForms {
	one: string;
	few: string;
	many: string;
}

export function plural(count: number, forms: PluralForms): string {
	const n = Math.abs(count);
	if (n === 1) return forms.one;
	if (n >= 2 && n <= 4 && Number.isInteger(n)) return forms.few;
	return forms.many;
}

/** "3 záznamy" — the count and the right form together. */
export function counted(count: number, forms: PluralForms): string {
	return `${count} ${plural(count, forms)}`;
}

export const RECORDS: PluralForms = { one: 'záznam', few: 'záznamy', many: 'záznamů' };
export const DAYS: PluralForms = { one: 'den', few: 'dny', many: 'dní' };
