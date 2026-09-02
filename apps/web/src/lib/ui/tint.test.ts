import { describe, expect, it } from 'vitest';
import { currencyTint } from './tint';

describe('currencyTint()', () => {
	it('is neutral for the home currency', () => {
		expect(currencyTint('CZK', 'CZK')).toBeNull();
	});

	it('names any other offered currency', () => {
		expect(currencyTint('EUR', 'CZK')).toBe('EUR');
		expect(currencyTint('GBP', 'CZK')).toBe('GBP');
	});

	it('follows the home currency rather than assuming koruny', () => {
		// A ledger whose first account is in euros is at home in euros.
		expect(currencyTint('EUR', 'EUR')).toBeNull();
		expect(currencyTint('CZK', 'EUR')).toBe('CZK');
	});

	it('is neutral when nothing is active or the code is unknown', () => {
		expect(currencyTint(null, 'CZK')).toBeNull();
		expect(currencyTint(undefined, 'CZK')).toBeNull();
		expect(currencyTint('JPY', 'CZK')).toBeNull();
	});
});
