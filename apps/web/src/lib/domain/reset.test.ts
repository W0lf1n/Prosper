import { describe, expect, it } from 'vitest';

import { RESET_PHRASE, matchesResetPhrase } from './reset';

describe('matchesResetPhrase', () => {
	it('accepts the phrase as it is printed', () => {
		expect(matchesResetPhrase(RESET_PHRASE)).toBe(true);
	});

	it('forgives case, diacritics and stray whitespace', () => {
		expect(matchesResetPhrase('Začínám znovu')).toBe(true);
		expect(matchesResetPhrase('ZAČÍNÁM ZNOVU')).toBe(true);
		expect(matchesResetPhrase('zacinam znovu')).toBe(true);
		expect(matchesResetPhrase('  začínám   znovu  ')).toBe(true);
	});

	it('refuses anything else', () => {
		expect(matchesResetPhrase('')).toBe(false);
		expect(matchesResetPhrase('začínám')).toBe(false);
		expect(matchesResetPhrase('znovu začínám')).toBe(false);
		expect(matchesResetPhrase('začínámznovu')).toBe(false);
		expect(matchesResetPhrase('začínám znovu.')).toBe(false);
		expect(matchesResetPhrase('ano')).toBe(false);
	});
});
