/**
 * Money.
 *
 * Every amount in this application is an integer number of haléře (CZK minor
 * units). Signed: negative = outflow, positive = inflow.
 *
 * Floating point for money is banned (PROJECT-PLAN §11.1). Nothing outside this
 * module may do arithmetic on an amount, parse one, or format one. If you find
 * yourself writing `/ 100` anywhere else, that is the bug.
 */

export type Minor = number & { __brand: 'minor' };

export const ZERO = 0 as Minor;

/** Largest amount we accept: ~90 000 000 000 000 Kč. Well past any real balance. */
const MAX = Number.MAX_SAFE_INTEGER;

/** Assert a raw number is a valid amount in minor units and brand it. */
export function minor(value: number): Minor {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`Amount is not a finite number: ${value}`);
	}
	if (!Number.isInteger(value)) {
		throw new TypeError(`Amount must be a whole number of haléře, got ${value}`);
	}
	if (Math.abs(value) > MAX) {
		throw new RangeError(`Amount out of safe range: ${value}`);
	}
	return value as Minor;
}

/** Build an amount from koruny and haléře: fromParts(1234, 50) → 1 234,50 Kč. */
export function fromParts(koruny: number, halere = 0): Minor {
	return minor(koruny * 100 + (koruny < 0 ? -halere : halere));
}

// ── arithmetic ──────────────────────────────────────────────────────────────

export function add(a: Minor, b: Minor): Minor {
	return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
	return minor(a - b);
}

export function neg(a: Minor): Minor {
	return minor(-a);
}

export function abs(a: Minor): Minor {
	return minor(Math.abs(a));
}

export function sum(values: Iterable<Minor>): Minor {
	let total = 0;
	for (const v of values) total += v;
	return minor(total);
}

export function cmp(a: Minor, b: Minor): -1 | 0 | 1 {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function isZero(a: Minor): boolean {
	return a === 0;
}

export function isOutflow(a: Minor): boolean {
	return a < 0;
}

/**
 * Multiply by the rational numerator/denominator, rounding half away from zero.
 *
 * Used for things like "required monthly contribution to this goal". Computed
 * in BigInt so the intermediate product cannot lose precision — BigInt is a
 * language primitive, not a decimal library, and never escapes this function.
 */
export function mulRatio(a: Minor, numerator: number, denominator: number): Minor {
	if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
		throw new TypeError('mulRatio takes integer numerator and denominator');
	}
	if (denominator === 0) throw new RangeError('mulRatio: denominator is zero');

	const product = BigInt(a) * BigInt(numerator);
	const div = BigInt(denominator);
	const q = product / div;
	const rem = product % div;

	// half away from zero
	const twiceRemainder = (rem < 0n ? -rem : rem) * 2n;
	const absDiv = div < 0n ? -div : div;
	const negative = product < 0n !== div < 0n;
	const rounded = twiceRemainder >= absDiv ? q + (negative ? -1n : 1n) : q;

	return minor(Number(rounded));
}

/**
 * Split an amount into `parts` shares that sum back exactly to the original.
 * Remainder haléře are handed out one each to the leading shares.
 */
export function split(a: Minor, parts: number): Minor[] {
	if (!Number.isInteger(parts) || parts < 1) throw new RangeError('split: parts must be >= 1');
	const sign = a < 0 ? -1 : 1;
	const magnitude = Math.abs(a);
	const base = Math.floor(magnitude / parts);
	const remainder = magnitude - base * parts;
	return Array.from({ length: parts }, (_, i) => minor(sign * (base + (i < remainder ? 1 : 0))));
}

/** Percentage of `whole` that `part` represents, rounded to a whole percent. */
export function percentOf(part: Minor, whole: Minor): number {
	if (whole === 0) return 0;
	return Math.round((Math.abs(part) / Math.abs(whole)) * 100);
}

// ── parsing ─────────────────────────────────────────────────────────────────

export type ParseError = 'empty' | 'not-a-number' | 'too-many-decimals' | 'out-of-range';
export type ParseResult = { ok: true; value: Minor } | { ok: false; error: ParseError };

/** Whitespace-ish characters people and locales use as thousand separators. */
const SEPARATORS = /[\s\u00a0\u202f\u2009'\u2019]/g;
const SHAPE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/**
 * Parse user input into minor units. Accepts Czech ("1 234,50"), plain
 * ("1234.5") and dot-grouped ("1.234,50"). Never uses parseFloat — the digits
 * are assembled as a string and converted exactly once.
 */
export function parseAmount(input: string): ParseResult {
	let s = String(input).replace(SEPARATORS, '');
	if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, ''); // dot was grouping
	s = s.replace(',', '.');

	if (s === '' || s === '-' || s === '+') return { ok: false, error: 'empty' };

	const m = SHAPE.exec(s);
	if (!m) return { ok: false, error: 'not-a-number' };

	const sign = m[1];
	const whole = m[2] ?? '';
	const frac = m[3] ?? '';
	if (whole === '' && frac === '') return { ok: false, error: 'empty' };
	if (frac.length > 2) return { ok: false, error: 'too-many-decimals' };

	const digits = (whole === '' ? '0' : whole) + frac.padEnd(2, '0');
	const value = Number(digits);
	if (!Number.isSafeInteger(value)) return { ok: false, error: 'out-of-range' };

	return { ok: true, value: minor(sign === '-' ? -value : value) };
}

// ── formatting ──────────────────────────────────────────────────────────────

const LOCALE = 'cs-CZ';
const CURRENCY = 'CZK';

const groupFormat = new Intl.NumberFormat(LOCALE, {
	useGrouping: true,
	maximumFractionDigits: 0
});

/** Locale glyphs pulled out of Intl once — never hand-rolled (§11.9). */
const GLYPHS = (() => {
	const parts = new Intl.NumberFormat(LOCALE, {
		style: 'currency',
		currency: CURRENCY
	}).formatToParts(-1);

	let decimal = ',';
	let minus = '-';
	let currency = 'Kč';
	let beforeCurrency = ' ';

	for (let i = 0; i < parts.length; i++) {
		const p = parts[i]!;
		if (p.type === 'decimal') decimal = p.value;
		if (p.type === 'minusSign') minus = p.value;
		if (p.type === 'currency') {
			currency = p.value;
			const prev = parts[i - 1];
			beforeCurrency = prev?.type === 'literal' ? prev.value : '';
		}
	}
	return { decimal, minus, currency, beforeCurrency };
})();

export interface FormatOptions {
	/** Append the currency symbol. Default true. */
	currency?: boolean;
	/** 'auto' shows a minus for outflows, 'always' forces a sign, 'never' formats the magnitude. */
	sign?: 'auto' | 'always' | 'never';
}

/**
 * Format an amount the Czech way: "1 234,50 Kč".
 *
 * The integer part goes through Intl for grouping; the fraction is the exact
 * integer remainder, so no division ever touches the value being displayed.
 */
export function formatMoney(value: Minor, options: FormatOptions = {}): string {
	const { currency = true, sign = 'auto' } = options;

	const negative = value < 0;
	const magnitude = Math.abs(value);
	const whole = Math.floor(magnitude / 100); // exact: magnitude is a safe integer
	const frac = magnitude - whole * 100;

	let out = groupFormat.format(whole) + GLYPHS.decimal + String(frac).padStart(2, '0');

	if (sign === 'auto' && negative) out = GLYPHS.minus + out;
	else if (sign === 'always') out = (negative ? GLYPHS.minus : '+') + out;

	if (currency) out += GLYPHS.beforeCurrency + GLYPHS.currency;
	return out;
}

/** Bare number, no currency symbol — for the entry keypad display. */
export function formatAmount(value: Minor): string {
	return formatMoney(value, { currency: false });
}

/** The currency symbol on its own, for labelling the keypad. */
export const CURRENCY_SYMBOL = GLYPHS.currency;
