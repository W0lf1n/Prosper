import { describe, expect, it } from 'vitest';
import type { Account, Category } from '$lib/domain/types';
import { CATEGORY_COLORS, accountColor, accountGlyph, categoryStyle, shortCode } from './palette';

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

	it('gives the wider list a family each, and stone to the rest (Q84)', () => {
		expect(accountColor('PLN', 'CZK')).toBe('red');
		expect(accountColor('CAD', 'CZK')).toBe('blue');
		expect(accountColor('NOK', 'CZK')).toBe('yellow');
		expect(accountColor('ZAR', 'CZK')).toBe('stone');
		// Away from home, koruny are just another currency.
		expect(accountColor('CZK', 'EUR')).toBe('stone');
	});
});

describe('accountGlyph — what is inside an account’s circle (Q83)', () => {
	function account(id: string, extra: Partial<Account> = {}): Account {
		return {
			id,
			name: id,
			kind: 'checking',
			openingBalance: 0 as Account['openingBalance'],
			openingDate: '2026-01-01',
			currency: 'CZK',
			pockets: [],
			isArchived: false,
			sortOrder: 0,
			updatedAt: '2026-10-05T00:00:00.000Z',
			deviceId: 'd',
			isDeleted: false,
			...extra
		};
	}

	it('is the currency symbol while the currency tells the accounts apart', () => {
		const kb = account('kb');
		const revolut = account('revolut', { currency: 'EUR', sortOrder: 1 });
		expect(accountGlyph(kb, [kb, revolut])).toEqual({ symbol: 'Kč' });
		expect(accountGlyph(revolut, [kb, revolut])).toEqual({ symbol: '€' });
	});

	it('is the kind once two accounts share a currency — the card and the cash', () => {
		const card = account('card');
		const cash = account('cash', { kind: 'cash', sortOrder: 1 });
		const savings = account('savings', { kind: 'savings', sortOrder: 2 });
		const all = [card, cash, savings];
		expect(accountGlyph(card, all)).toEqual({ icon: 'credit-card' });
		expect(accountGlyph(cash, all)).toEqual({ icon: 'banknote' });
		expect(accountGlyph(savings, all)).toEqual({ icon: 'piggy-bank' });
	});
});

describe('shortCode', () => {
	it('keeps an abbreviation and shortens a name', () => {
		expect(shortCode('ETF portfolio')).toBe('ETF');
		expect(shortCode('Penzijní spoření')).toBe('Pe');
		expect(shortCode('')).toBe('·');
	});
});
