/**
 * Dates.
 *
 * A transaction date is a plain local calendar day, "YYYY-MM-DD", with no
 * timezone attached (PROJECT-PLAN §4). A transaction entered at 23:50 in Brno
 * belongs to that day, full stop. Anything that needs an instant — updatedAt,
 * createdAt — uses a full ISO datetime instead.
 */

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // 2026-08-23T19:15:40.123Z

const LOCALE = 'cs-CZ';

/** Local calendar day of a Date, without going through UTC. */
export function toIsoDate(date: Date): IsoDate {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function today(): IsoDate {
	return toIsoDate(new Date());
}

export function nowIso(): IsoDateTime {
	return new Date().toISOString();
}

/** Local midnight of an ISO date. Never `new Date('2026-08-23')` — that is UTC. */
export function fromIsoDate(iso: IsoDate): Date {
	const [year, month, day] = iso.split('-').map(Number);
	return new Date(year!, month! - 1, day!);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
	const date = fromIsoDate(iso);
	date.setDate(date.getDate() + days);
	return toIsoDate(date);
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
	const ms = fromIsoDate(to).getTime() - fromIsoDate(from).getTime();
	return Math.round(ms / 86_400_000);
}

export function startOfMonth(iso: IsoDate): IsoDate {
	return `${iso.slice(0, 7)}-01`;
}

export function monthKey(iso: IsoDate): string {
	return iso.slice(0, 7);
}

/** Number of days a month has. Takes a month key, "YYYY-MM". */
export function daysInMonth(month: string): number {
	const [year, m] = month.split('-').map(Number);
	return new Date(year!, m!, 0).getDate();
}

/** Last calendar day of a month, as an ISO date. */
export function endOfMonth(month: string): IsoDate {
	return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** Move a month key by whole months. `shiftMonth('2026-01', -1)` → '2025-12'. */
export function shiftMonth(month: string, delta: number): string {
	const [year, m] = month.split('-').map(Number);
	const date = new Date(year!, m! - 1 + delta, 1);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Whole months from `month` through the month of `targetDate`, counting both
 * ends. Zero once the target month is behind us — a goal whose date has passed
 * has no months left to spread anything over.
 */
export function monthsUntil(month: string, targetDate: IsoDate): number {
	const target = monthKey(targetDate);
	if (target < month) return 0;
	const [fromYear, fromMonth] = month.split('-').map(Number);
	const [toYear, toMonth] = target.split('-').map(Number);
	return (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!) + 1;
}

// ── Czech display formatting, all through Intl (§11.9) ──────────────────────

const dayFormat = new Intl.DateTimeFormat(LOCALE, {
	weekday: 'short',
	day: 'numeric',
	month: 'long'
});

const dayWithYearFormat = new Intl.DateTimeFormat(LOCALE, {
	weekday: 'short',
	day: 'numeric',
	month: 'long',
	year: 'numeric'
});

const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' });
const shortFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'numeric' });

/** "dnes", "včera", "ne 23. srpna", or with the year once it is not this year. */
export function formatDayHeading(iso: IsoDate, reference: IsoDate = today()): string {
	const delta = daysBetween(iso, reference);
	if (delta === 0) return 'dnes';
	if (delta === 1) return 'včera';
	if (delta === -1) return 'zítra';

	const date = fromIsoDate(iso);
	const sameYear = iso.slice(0, 4) === reference.slice(0, 4);
	return (sameYear ? dayFormat : dayWithYearFormat).format(date);
}

export function formatMonthHeading(iso: IsoDate): string {
	return monthFormat.format(fromIsoDate(iso));
}

/** "23. 8." — for dense rows where the day heading already carries the context. */
export function formatShortDate(iso: IsoDate): string {
	return shortFormat.format(fromIsoDate(iso));
}

/** Czech plural: 1 den / 2 dny / 5 dní. */
export function daysWord(count: number): string {
	const n = Math.abs(count);
	if (n === 1) return 'den';
	if (n >= 2 && n <= 4) return 'dny';
	return 'dní';
}
