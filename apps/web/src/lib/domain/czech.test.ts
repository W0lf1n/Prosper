import { describe, expect, it } from 'vitest';
import { CATEGORIES, DAYS, RECORDS, capitalize, counted, plural } from './czech';

describe('plural()', () => {
	it('picks the three Czech forms', () => {
		expect(plural(1, RECORDS)).toBe('záznam');
		expect(plural(2, RECORDS)).toBe('záznamy');
		expect(plural(4, RECORDS)).toBe('záznamy');
		expect(plural(5, RECORDS)).toBe('záznamů');
		expect(plural(0, RECORDS)).toBe('záznamů');
		expect(plural(11, RECORDS)).toBe('záznamů');
	});

	it('ignores the sign', () => {
		expect(plural(-3, DAYS)).toBe('dny');
	});
});

describe('counted()', () => {
	it('puts the number in front of the right form', () => {
		expect(counted(1, DAYS)).toBe('1 den');
		expect(counted(3, DAYS)).toBe('3 dny');
		expect(counted(23, DAYS)).toBe('23 dní');
	});

	it('knows a category, which does not change between one and four', () => {
		expect(counted(1, CATEGORIES)).toBe('1 kategorie');
		expect(counted(3, CATEGORIES)).toBe('3 kategorie');
		expect(counted(10, CATEGORIES)).toBe('10 kategorií');
	});
});

describe('capitalize', () => {
	it('lifts the first letter and leaves the rest alone', () => {
		expect(capitalize('srpen 2026')).toBe('Srpen 2026');
		expect(capitalize('účet')).toBe('Účet');
		expect(capitalize('')).toBe('');
	});
});
