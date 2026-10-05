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

/**
 * Round to the nearest whole unit of the currency — 1 234,50 → 1 235,00 —
 * half away from zero. For figures a person will act on by hand: a standing
 * order is not set in haléře.
 */
export function roundToUnit(a: Minor): Minor {
	return mulRatio(mulRatio(a, 1, 100), 100, 1);
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

/**
 * Parse a balance typed as a magnitude beside a sign pill — Q85.
 *
 * The decimal keypad most phones show has no minus key, so a balance below
 * zero is typed as its magnitude and the pill says which side of zero it is
 * on. A minus typed into the field by hand says the same thing and wins over
 * a pill left on plus; zero is zero whichever pill is lit.
 */
export function parseSigned(input: string, negative: boolean): ParseResult {
	const parsed = parseAmount(input);
	if (!parsed.ok) return parsed;
	const magnitude = Math.abs(parsed.value);
	const below = magnitude !== 0 && (negative || parsed.value < 0);
	return { ok: true, value: minor(below ? -magnitude : magnitude) };
}

// ── formatting ──────────────────────────────────────────────────────────────

const LOCALE = 'cs-CZ';

/** The currency everything defaults to, and the one goals are measured in. */
export const HOME_CURRENCY = 'CZK';

/**
 * The currencies an account may be opened in — the four of Q49, widened on
 * 2026-10-05 (Q84) to the ones a Czech wallet actually meets: the
 * neighbours, the Nordics, the holiday destinations, the dollars.
 *
 * Every entry has **two minor-unit digits** in ISO 4217, so a `Minor` means
 * the same thing whatever the account: hundredths. A currency with zero
 * decimals (JPY, KRW, ISK) would quietly redefine the unit, and stays out
 * until it is actually needed. The forint is two digits in ISO even though
 * nobody has seen a fillér since 1999, so it is in, and prints ",00".
 * Bulgaria joined the euro on 2026-01-01, so the lev is not offered.
 *
 * Home and the first three keep their places; the order is the order of the
 * select.
 */
export const CURRENCIES = [
	'CZK',
	'EUR',
	'USD',
	'GBP',
	'PLN',
	'CHF',
	'HUF',
	'SEK',
	'NOK',
	'DKK',
	'RON',
	'TRY',
	'UAH',
	'CAD',
	'AUD',
	'NZD',
	'CNY',
	'HKD',
	'SGD',
	'THB',
	'AED',
	'ILS',
	'INR',
	'MXN',
	'BRL',
	'ZAR'
] as const;

/**
 * Where the Czech locale prints a bare ISO code — "PLN", "HUF" — but the
 * currency has a sign people read, the narrow symbol is used instead: "zł",
 * "Ft", "₴". Only where it is unambiguous among the offered currencies: "$"
 * belongs to seven of them and "kr" to three, so those keep "US$" and "SEK".
 * The glyph itself still comes out of Intl (§11.9); this only picks which of
 * its two forms.
 */
const NARROW_SYMBOL = new Set(['PLN', 'HUF', 'TRY', 'UAH', 'THB', 'ILS', 'INR']);

const groupFormat = new Intl.NumberFormat(LOCALE, {
	useGrouping: true,
	maximumFractionDigits: 0
});

interface Glyphs {
	decimal: string;
	minus: string;
	currency: string;
	beforeCurrency: string;
}

/**
 * Locale glyphs pulled out of Intl, once per currency — never hand-rolled
 * (§11.9). The Czech locale for every code, so "1 234,50 €" and "1 234,50 Kč"
 * read as the same app with a different symbol, not as two apps.
 */
const glyphCache = new Map<string, Glyphs>();

function glyphsFor(code: string): Glyphs {
	const cached = glyphCache.get(code);
	if (cached) return cached;

	const parts = currencyParts(code, NARROW_SYMBOL.has(code) ? 'narrowSymbol' : 'symbol');

	let decimal = ',';
	let minus = '-';
	let currency = code;
	let beforeCurrency = ' ';

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

	const glyphs = { decimal, minus, currency, beforeCurrency };
	glyphCache.set(code, glyphs);
	return glyphs;
}

/** `formatToParts(-1)` for a code, falling back to the plain symbol on an
    engine that does not know `narrowSymbol`. */
function currencyParts(code: string, display: 'symbol' | 'narrowSymbol'): Intl.NumberFormatPart[] {
	try {
		return new Intl.NumberFormat(LOCALE, {
			style: 'currency',
			currency: code,
			currencyDisplay: display
		}).formatToParts(-1);
	} catch {
		return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code }).formatToParts(-1);
	}
}

let currencyNames: Intl.DisplayNames | null | undefined;

/**
 * The currency's Czech name — "polský zlotý", "švýcarský frank" — for the
 * select an account is opened from. Out of Intl, like every other word the
 * locale already knows; the bare code where the engine cannot say.
 */
export function currencyName(code: string): string {
	if (currencyNames === undefined) {
		try {
			currencyNames = new Intl.DisplayNames(LOCALE, { type: 'currency' });
		} catch {
			currencyNames = null;
		}
	}
	return currencyNames?.of(code) ?? code;
}

export interface FormatOptions {
	/** Append the currency symbol. Default true. */
	currency?: boolean;
	/** 'auto' shows a minus for outflows, 'always' forces a sign, 'never' formats the magnitude. */
	sign?: 'auto' | 'always' | 'never';
	/** ISO currency code. Defaults to the home currency, CZK. */
	code?: string;
}

/**
 * Format an amount the Czech way: "1 234,50 Kč" — or "1 234,50 €" for an
 * account held in euros. The *number* is always Czech; only the symbol moves.
 *
 * The integer part goes through Intl for grouping; the fraction is the exact
 * integer remainder, so no division ever touches the value being displayed.
 */
export function formatMoney(value: Minor, options: FormatOptions = {}): string {
	const { currency = true, sign = 'auto', code = HOME_CURRENCY } = options;
	const glyphs = glyphsFor(code);

	const negative = value < 0;
	const magnitude = Math.abs(value);
	const whole = Math.floor(magnitude / 100); // exact: magnitude is a safe integer
	const frac = magnitude - whole * 100;

	let out = groupFormat.format(whole) + glyphs.decimal + String(frac).padStart(2, '0');

	if (sign === 'auto' && negative) out = glyphs.minus + out;
	else if (sign === 'always') out = (negative ? glyphs.minus : '+') + out;

	if (currency) out += (glyphs.beforeCurrency || ' ') + glyphs.currency;
	return out;
}

/** Bare number, no currency symbol — for the entry keypad display. */
export function formatAmount(value: Minor): string {
	return formatMoney(value, { currency: false });
}

/** The currency symbol on its own, for labelling the keypad and the switcher. */
export function currencySymbol(code: string = HOME_CURRENCY): string {
	return glyphsFor(code).currency;
}
