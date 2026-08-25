import { describe, expect, it } from 'vitest';
import {
	ZERO,
	abs,
	add,
	cmp,
	formatAmount,
	formatMoney,
	fromParts,
	isOutflow,
	minor,
	mulRatio,
	neg,
	parseAmount,
	percentOf,
	split,
	sub,
	sum,
	type Minor
} from './money';

/** Shorthand for a literal amount in minor units. */
const m = (n: number) => minor(n);

const NBSP = '\u00a0';

describe('minor()', () => {
	it('brands whole numbers', () => {
		expect(m(0)).toBe(0);
		expect(m(-12345)).toBe(-12345);
	});

	it('rejects fractional haléře — the whole point of the ban', () => {
		expect(() => m(12.5)).toThrow(TypeError);
		expect(() => m(0.1 + 0.2)).toThrow(TypeError);
	});

	it('rejects NaN, Infinity and unsafe magnitudes', () => {
		expect(() => m(NaN)).toThrow(TypeError);
		expect(() => m(Infinity)).toThrow(TypeError);
		expect(() => m(Number.MAX_SAFE_INTEGER + 10)).toThrow();
	});
});

describe('fromParts()', () => {
	it('composes koruny and haléře', () => {
		expect(fromParts(1234, 50)).toBe(123450);
		expect(fromParts(0, 5)).toBe(5);
		expect(fromParts(20)).toBe(2000);
	});

	it('keeps haléře on the same side of zero as koruny', () => {
		expect(fromParts(-1234, 50)).toBe(-123450);
	});
});

describe('arithmetic', () => {
	it('adds and subtracts exactly where floats would drift', () => {
		// 0.1 + 0.2 in koruny — the canonical float failure
		expect(add(m(10), m(20))).toBe(30);
		expect(sub(m(10), m(20))).toBe(-10);
	});

	it('sums a ledger of mixed signs', () => {
		const rows: Minor[] = [m(-12990), m(-4550), m(3500000), m(-129900)];
		expect(sum(rows)).toBe(3352560);
	});

	it('sums nothing to zero', () => {
		expect(sum([])).toBe(ZERO);
	});

	it('negates and takes magnitude', () => {
		expect(neg(m(-4550))).toBe(4550);
		expect(abs(m(-4550))).toBe(4550);
		expect(abs(m(4550))).toBe(4550);
	});

	it('compares', () => {
		expect(cmp(m(-100), m(100))).toBe(-1);
		expect(cmp(m(100), m(100))).toBe(0);
		expect(cmp(m(100), m(-100))).toBe(1);
	});

	it('knows an outflow from an inflow', () => {
		expect(isOutflow(m(-1))).toBe(true);
		expect(isOutflow(m(0))).toBe(false);
		expect(isOutflow(m(1))).toBe(false);
	});

	it('survives a lifetime of transactions without losing a haléř', () => {
		const rows = Array.from({ length: 100_000 }, () => m(-12345));
		expect(sum(rows)).toBe(-1_234_500_000);
	});
});

describe('mulRatio() rounding', () => {
	it('rounds half away from zero', () => {
		expect(mulRatio(m(101), 1, 2)).toBe(51); // 50.5 → 51
		expect(mulRatio(m(-101), 1, 2)).toBe(-51); // -50.5 → -51
		expect(mulRatio(m(100), 1, 3)).toBe(33); // 33.33 → 33
		expect(mulRatio(m(200), 1, 3)).toBe(67); // 66.67 → 67
	});

	it('divides a goal into monthly contributions', () => {
		// 50 000 Kč over 7 months
		expect(mulRatio(m(5_000_00), 1, 7)).toBe(71429);
	});

	it('is exact for large products where float multiplication would drift', () => {
		expect(mulRatio(m(999_999_999_99), 7, 3)).toBe(233333333331);
	});

	it('rejects a zero denominator and non-integer ratios', () => {
		expect(() => mulRatio(m(100), 1, 0)).toThrow(RangeError);
		expect(() => mulRatio(m(100), 1.5, 2)).toThrow(TypeError);
	});
});

describe('split()', () => {
	it('distributes the remainder so the parts sum back exactly', () => {
		const parts = split(m(1000), 3);
		expect(parts).toEqual([334, 333, 333]);
		expect(sum(parts)).toBe(1000);
	});

	it('handles negative amounts', () => {
		const parts = split(m(-1000), 3);
		expect(parts).toEqual([-334, -333, -333]);
		expect(sum(parts)).toBe(-1000);
	});

	it('rejects a nonsense part count', () => {
		expect(() => split(m(100), 0)).toThrow(RangeError);
	});
});

describe('percentOf()', () => {
	it('computes a whole-percent ratio', () => {
		expect(percentOf(m(-3000), m(-10000))).toBe(30);
		expect(percentOf(m(0), m(0))).toBe(0);
	});
});

describe('parseAmount()', () => {
	it('parses plain input', () => {
		expect(parseAmount('1234')).toEqual({ ok: true, value: 123400 });
		expect(parseAmount('1234.5')).toEqual({ ok: true, value: 123450 });
		expect(parseAmount('0,05')).toEqual({ ok: true, value: 5 });
	});

	it('parses Czech input with a comma and grouping spaces', () => {
		expect(parseAmount('1 234,50')).toEqual({ ok: true, value: 123450 });
		expect(parseAmount(`1${NBSP}234,50`)).toEqual({ ok: true, value: 123450 });
	});

	it('parses dot-grouped input', () => {
		expect(parseAmount('1.234,50')).toEqual({ ok: true, value: 123450 });
	});

	it('parses negative amounts', () => {
		expect(parseAmount('-1 234,50')).toEqual({ ok: true, value: -123450 });
		expect(parseAmount('-0,01')).toEqual({ ok: true, value: -1 });
	});

	it('pads a single decimal digit', () => {
		expect(parseAmount('12,5')).toEqual({ ok: true, value: 1250 });
		expect(parseAmount('12,')).toEqual({ ok: true, value: 1200 });
		expect(parseAmount(',5')).toEqual({ ok: true, value: 50 });
	});

	it('refuses rather than silently rounding sub-haléř precision', () => {
		expect(parseAmount('1,005')).toEqual({ ok: false, error: 'too-many-decimals' });
	});

	it('rejects junk', () => {
		expect(parseAmount('')).toEqual({ ok: false, error: 'empty' });
		expect(parseAmount('-')).toEqual({ ok: false, error: 'empty' });
		expect(parseAmount('12a')).toEqual({ ok: false, error: 'not-a-number' });
		expect(parseAmount('1e5')).toEqual({ ok: false, error: 'not-a-number' });
		expect(parseAmount('1,2,3')).toEqual({ ok: false, error: 'not-a-number' });
	});

	it('rejects amounts beyond exact integer range', () => {
		expect(parseAmount('999999999999999999')).toEqual({ ok: false, error: 'out-of-range' });
	});

	it('round-trips through formatting', () => {
		const original = m(-1234567890);
		const reparsed = parseAmount(formatMoney(original, { currency: false }));
		expect(reparsed).toEqual({ ok: true, value: original });
	});
});

describe('formatMoney()', () => {
	it('formats the Czech way', () => {
		expect(formatMoney(m(123450))).toBe(`1${NBSP}234,50${NBSP}Kč`);
	});

	it('formats negative amounts', () => {
		expect(formatMoney(m(-123450))).toBe(`-1${NBSP}234,50${NBSP}Kč`);
	});

	it('always shows two decimal places', () => {
		expect(formatMoney(m(0))).toBe(`0,00${NBSP}Kč`);
		expect(formatMoney(m(5))).toBe(`0,05${NBSP}Kč`);
		expect(formatMoney(m(50))).toBe(`0,50${NBSP}Kč`);
		expect(formatMoney(m(100))).toBe(`1,00${NBSP}Kč`);
	});

	it('groups large amounts', () => {
		expect(formatMoney(m(123456789))).toBe(`1${NBSP}234${NBSP}567,89${NBSP}Kč`);
	});

	it('is exact at magnitudes where a float division would round', () => {
		expect(formatMoney(m(90071992547409))).toBe(`900${NBSP}719${NBSP}925${NBSP}474,09${NBSP}Kč`);
	});

	it('can drop the currency and force a sign', () => {
		expect(formatAmount(m(123450))).toBe(`1${NBSP}234,50`);
		expect(formatMoney(m(123450), { sign: 'always' })).toBe(`+1${NBSP}234,50${NBSP}Kč`);
		expect(formatMoney(m(-123450), { sign: 'never', currency: false })).toBe(`1${NBSP}234,50`);
	});
});
