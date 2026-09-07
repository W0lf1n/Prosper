/**
 * Starting over.
 *
 * The one destructive action in the app, and the only place friction is the
 * point. Everything else here is built to get out of the way in five seconds;
 * this asks for a sentence to be typed out, because the cost of doing it by
 * accident is the whole ledger.
 *
 * A phrase rather than a "jsi si jistý?" — a confirm dialog is dismissed by the
 * same tap that opened it, and the tap is muscle memory by the second time it
 * is seen. Thirteen characters cannot be muscle memory.
 *
 * It is still a *soft* delete underneath (§13.2). Nothing is destroyed; the
 * rows are flagged and stay flagged, which is what lets the wipe travel to the
 * server as ordinary rows and what keeps a restored backup able to overrule it.
 */

import { normalize } from './vocabulary';

/** Typed out to unlock the wipe. Shown on screen, in this exact form. */
export const RESET_PHRASE = 'začínám znovu';

/**
 * Case and diacritics are folded, and runs of whitespace collapse to one.
 *
 * The deliberateness this gate is buying comes from typing thirteen characters,
 * not from getting the accents right on a phone keyboard at midnight — and a
 * confirmation somebody has to attempt three times is a confirmation they stop
 * reading.
 */
export function matchesResetPhrase(typed: string): boolean {
	return collapse(typed) === collapse(RESET_PHRASE);
}

function collapse(text: string): string {
	return normalize(text).replace(/\s+/g, ' ');
}
