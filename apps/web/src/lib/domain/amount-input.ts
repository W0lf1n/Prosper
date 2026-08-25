/**
 * The keypad's state machine.
 *
 * Whole koruny first, haléře only after an explicit comma. Typing "249" means
 * 249 Kč, not 2,49 Kč — most Czech prices are whole koruny, and three taps
 * beats five when the whole design is arguing about five seconds.
 *
 * Pure (§11.6): the component holds one of these and does nothing else.
 */

import { ZERO, minor, parseAmount, type Minor } from './money';

export interface AmountInput {
	/** Digits before the comma. '' renders as 0. */
	whole: string;
	/** Digits after the comma; null means the comma has not been pressed. */
	frac: string | null;
}

export const EMPTY: AmountInput = { whole: '', frac: null };

const MAX_WHOLE_DIGITS = 9; // 999 999 999 Kč — past that, it is not an expense

export function pressDigit(state: AmountInput, digit: string): AmountInput {
	if (!/^[0-9]$/.test(digit)) return state;

	if (state.frac !== null) {
		if (state.frac.length >= 2) return state;
		return { ...state, frac: state.frac + digit };
	}

	// No leading zeros: "0" then "5" is 5, not 05.
	const next = state.whole === '0' ? digit : state.whole + digit;
	if (next.length > MAX_WHOLE_DIGITS) return state;
	return { ...state, whole: next };
}

export function pressComma(state: AmountInput): AmountInput {
	if (state.frac !== null) return state;
	return { whole: state.whole === '' ? '0' : state.whole, frac: '' };
}

export function pressBackspace(state: AmountInput): AmountInput {
	if (state.frac !== null) {
		if (state.frac.length > 0) return { ...state, frac: state.frac.slice(0, -1) };
		return { ...state, frac: null }; // removes the comma itself
	}
	return { ...state, whole: state.whole.slice(0, -1) };
}

export function clear(): AmountInput {
	return EMPTY;
}

export function isEmpty(state: AmountInput): boolean {
	return state.whole === '' && state.frac === null;
}

/** The amount, always positive. The direction toggle applies the sign. */
export function toMinor(state: AmountInput): Minor {
	if (isEmpty(state)) return ZERO;
	const whole = state.whole === '' ? '0' : state.whole;
	const frac = (state.frac ?? '').padEnd(2, '0');
	const result = parseAmount(`${whole}.${frac}`);
	return result.ok ? result.value : ZERO;
}

/** Build an input state from an existing amount, for the edit form. */
export function fromMinor(value: Minor): AmountInput {
	const magnitude = Math.abs(value);
	const whole = Math.floor(magnitude / 100);
	const frac = magnitude - whole * 100;
	return frac === 0
		? { whole: String(whole), frac: null }
		: { whole: String(whole), frac: String(frac).padStart(2, '0') };
}

const groupFormat = new Intl.NumberFormat('cs-CZ', {
	useGrouping: true,
	maximumFractionDigits: 0
});

/**
 * What the big display shows while typing. Mid-entry states are shown as typed
 * ("249," not "249,00") so the pad never argues with the thumb.
 */
export function display(state: AmountInput): string {
	const whole = groupFormat.format(Number(state.whole === '' ? '0' : state.whole));
	if (state.frac === null) return whole;
	return `${whole},${state.frac}`;
}

/** True once there is a non-zero amount worth saving. */
export function isSavable(state: AmountInput): boolean {
	return toMinor(state) !== 0;
}

export { minor as asMinor };
