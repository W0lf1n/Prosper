import { describe, expect, it } from 'vitest';
import type { Category } from '$lib/domain/types';
import { CATEGORY_COLORS, accountColor, categoryStyle, shortCode } from './palette';

function category(overrides: Partial<Category>): Category {
	return {
		id: 'c',
		parentId: null,
		name: 'JÍDLO',
		spendType: 'want',
		monthlyCap: null,
		sortOrder: 0,
		isArchived: false,
		isIncome: false,
		icon: 'utensils',
		color: 'orange',
		updatedAt: '2026-09-05T00:00:00.000Z',
		deviceId: 'd',
		isDeleted: false,
		...overrides
	};
}

/** A row as an older build wrote it — the two style fields absent, not empty. */
function legacy(overrides: Partial<Category>): Category {
	const row = category(overrides);
	return Object.fromEntries(
		Object.entries(row).filter(([key]) => key !== 'icon' && key !== 'color')
	) as Category;
}

describe('categoryStyle', () => {
	it('reads the stored style when it is one the app knows', () => {
		expect(categoryStyle(category({ icon: 'coffee', color: 'red' }))).toEqual({
			icon: 'coffee',
			color: 'red'
		});
	});

	it('falls back by name for a row written before the fields existed', () => {
		expect(categoryStyle(legacy({ name: 'Bydlení' }))).toEqual({ icon: 'house', color: 'blue' });
	});

	it('gives an unknown name the plain tag on stone', () => {
		expect(categoryStyle(legacy({ name: 'PES' }))).toEqual({ icon: 'tag', color: 'stone' });
	});

	it('refuses an icon or a colour it cannot draw, one field at a time', () => {
		expect(categoryStyle(category({ icon: 'unicorn', color: 'orange' }))).toEqual({
			icon: 'utensils',
			color: 'orange'
		});
		expect(categoryStyle(category({ icon: 'coffee', color: 'magenta' }))).toEqual({
			icon: 'coffee',
			color: 'orange'
		});
	});

	it('answers for no category at all', () => {
		expect(categoryStyle(null)).toEqual({ icon: 'tag', color: 'stone' });
	});

	it('offers ten colours', () => {
		expect(CATEGORY_COLORS).toHaveLength(10);
	});
});

describe('accountColor', () => {
	it('is the accent at home and a hue of its own abroad', () => {
		expect(accountColor('CZK', 'CZK')).toBe('cobalt');
		expect(accountColor('EUR', 'CZK')).toBe('teal');
		expect(accountColor('USD', 'CZK')).toBe('blue');
		expect(accountColor('GBP', 'CZK')).toBe('pink');
		expect(accountColor('EUR', 'EUR')).toBe('cobalt');
	});
});

describe('shortCode', () => {
	it('keeps an abbreviation and shortens a name', () => {
		expect(shortCode('ETF portfolio')).toBe('ETF');
		expect(shortCode('Penzijní spoření')).toBe('Pe');
		expect(shortCode('')).toBe('·');
	});
});
