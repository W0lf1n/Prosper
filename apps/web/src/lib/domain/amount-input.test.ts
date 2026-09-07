import { describe, expect, it } from 'vitest';
import {
	EMPTY,
	display,
	fromMinor,
	isEmpty,
	isSavable,
	pressBackspace,
	pressComma,
	pressDigit,
	toMinor,
	type AmountInput
} from './amount-input';
import { minor } from './money';

/** Type a sequence of keys: digits, ',' and '<' for backspace. */
function type(keys: string, from: AmountInput = EMPTY): AmountInput {
	let state = from;
	for (const key of keys) {
		if (key === ',') state = pressComma(state);
		else if (key === '<') state = pressBackspace(state);
		else state = pressDigit(state, key);
	}
	return state;
}

const NBSP = '\u00a0';

describe('keypad entry', () => {
	it('types whole koruny first — three taps for a 249 Kč expense', () => {
		expect(toMinor(type('249'))).toBe(24900);
	});

	it('takes haléře only after the comma', () => {
		expect(toMinor(type('249,50'))).toBe(24950);
		expect(toMinor(type('0,05'))).toBe(5);
	});

	it('pads a single haléř digit', () => {
		expect(toMinor(type('12,5'))).toBe(1250);
	});

	it('ignores a third decimal digit rather than rounding it away', () => {
		expect(toMinor(type('1,239'))).toBe(123);
	});

	it('ignores a second comma', () => {
		expect(display(type('1,2,3'))).toBe('1,23');
	});

	it('starts the fraction from zero when the comma comes first', () => {
		expect(toMinor(type(',50'))).toBe(50);
		expect(display(type(',5'))).toBe('0,5');
	});

	it('does not keep leading zeros', () => {
		expect(display(type('05'))).toBe('5');
		expect(toMinor(type('000'))).toBe(0);
	});

	it('refuses absurd magnitudes', () => {
		expect(display(type('1234567890'))).toBe(`123${NBSP}456${NBSP}789`);
	});
});

describe('backspace', () => {
	it('deletes the last digit', () => {
		expect(display(type('249<'))).toBe('24');
	});

	it('deletes haléře, then the comma, then koruny', () => {
		expect(display(type('12,50<'))).toBe('12,5');
		expect(display(type('12,50<<'))).toBe('12,');
		expect(display(type('12,50<<<'))).toBe('12');
		expect(display(type('12,50<<<<'))).toBe('1');
	});

	it('bottoms out at empty', () => {
		const state = type('1<<<');
		expect(isEmpty(state)).toBe(true);
		expect(display(state)).toBe('0');
	});
});

describe('display', () => {
	it('groups thousands the Czech way while typing', () => {
		expect(display(type('12345'))).toBe(`12${NBSP}345`);
	});

	it('shows the comma as typed, without inventing haléře', () => {
		expect(display(type('249,'))).toBe('249,');
		expect(display(type('249'))).toBe('249');
	});
});

describe('save gate', () => {
	it('will not save nothing', () => {
		expect(isSavable(EMPTY)).toBe(false);
		expect(isSavable(type('0'))).toBe(false);
		expect(isSavable(type('0,00'))).toBe(false);
	});

	it('saves anything non-zero, down to a single haléř', () => {
		expect(isSavable(type('0,01'))).toBe(true);
	});
});

describe('fromMinor()', () => {
	it('round-trips an existing amount back into the pad', () => {
		expect(fromMinor(minor(-24950))).toEqual({ whole: '249', frac: '50' });
		expect(fromMinor(minor(24900))).toEqual({ whole: '249', frac: null });
		expect(toMinor(fromMinor(minor(-24950)))).toBe(24950);
	});
});
