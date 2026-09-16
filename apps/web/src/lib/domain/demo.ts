/**
 * The demo ledger — what the demo instance opens with (DECISIONS Q74).
 *
 * A *description* of a ledger, relative to `today`, from a fixed seed: the
 * same day produces the same rows, so a test can say what is in it, and the
 * demo is never stale because every date is counted back from the day it is
 * opened. Pure — nothing here knows Dexie; `lib/db/demo.ts` writes it through
 * `repo.ts` like anything typed by hand.
 *
 * What it is built to show: a tape with a few months on it and a no-spend day
 * or two; the deck of dues on Domů (the rent and Netflix are typed for the
 * months before this one and *declared* for this one, so the app asks); a
 * one-off, a hold, and a shared dinner, so each of the three chips has a row
 * wearing it; a goal with a head start; a holding with a run of valuations.
 */

import { addDays, endOfMonth, fromIsoDate, monthKey, shiftMonth, type IsoDate } from './datetime';
import { minor, type Minor } from './money';
import type { HoldingKind, ScheduleMode } from './types';

export interface DemoTxn {
	date: IsoDate;
	/** Signed, like `Txn.amount`. */
	amount: Minor;
	/** A bucket by its seeded name — `db/seed.ts` is the dictionary. */
	category: string;
	payee: string;
	isOneOff?: boolean;
	isProvisional?: boolean;
	shares?: { who: string; amount: Minor }[];
}

export interface DemoSchedule {
	payee: string;
	category: string;
	amount: Minor;
	dayOfMonth: number;
	mode: ScheduleMode;
}

export interface DemoLedger {
	openingBalance: Minor;
	openingDate: IsoDate;
	txns: DemoTxn[];
	schedules: DemoSchedule[];
	goal: {
		name: string;
		why: string;
		targetAmount: Minor;
		targetDate: IsoDate;
		startAmount: Minor;
		category: string;
	};
	holding: {
		name: string;
		kind: HoldingKind;
		valuations: { date: IsoDate; value: Minor }[];
	};
}

/** How far back the tape reaches. */
export const DEMO_DAYS = 75;

const INCOME = 'PŘÍJEM';
const RENT = minor(-14_500_00);
const NETFLIX = minor(-379_00);
const SPOTIFY = minor(-169_00);
const SALARY = minor(52_000_00);
const SAVING = minor(-5_000_00);

/** mulberry32 — a seeded generator, so the demo is the same every morning. */
function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function koruny(rnd: () => number, from: number, to: number): Minor {
	return minor(-Math.round(from + rnd() * (to - from)) * 100);
}

function pick<T>(rnd: () => number, items: readonly T[]): T {
	return items[Math.floor(rnd() * items.length)]!;
}

function isWeekday(date: IsoDate): boolean {
	const day = fromIsoDate(date).getUTCDay();
	return day >= 1 && day <= 5;
}

export function demoLedger(today: IsoDate): DemoLedger {
	const rnd = random(20260916);
	const openingDate = addDays(today, -(DEMO_DAYS + 1));
	const txns: DemoTxn[] = [];

	// ── the everyday rows ────────────────────────────────────────────────────
	for (let back = DEMO_DAYS; back >= 0; back -= 1) {
		const date = addDays(today, -back);
		const weekday = isWeekday(date);

		if (rnd() < 0.42) {
			txns.push({
				date,
				amount: koruny(rnd, 150, 900),
				category: 'POTRAVINY',
				payee: pick(rnd, ['Albert', 'Lidl', 'Billa', 'Kaufland', 'Rohlík'])
			});
		}
		if (weekday && rnd() < 0.5) {
			txns.push({
				date,
				amount: koruny(rnd, 89, 260),
				category: 'JÍDLO',
				payee: pick(rnd, ['oběd', 'Bageterie', 'kantýna', 'kafe'])
			});
		}
		if (rnd() < 0.1) {
			txns.push({
				date,
				amount: koruny(rnd, 199, 1490),
				category: 'LIFESTYLE',
				payee: pick(rnd, ['kino', 'Decathlon', 'kadeřník', 'knihy'])
			});
		}
		if (rnd() < 0.07) {
			txns.push({
				date,
				amount: koruny(rnd, 60, 600),
				category: 'OSTATNÍ',
				payee: pick(rnd, ['lékárna', 'poštovné', 'parkování'])
			});
		}
		if (rnd() < 0.04) {
			txns.push({
				date,
				amount: koruny(rnd, 300, 2400),
				category: 'PROJEKTY',
				payee: pick(rnd, ['Hornbach', 'OBI'])
			});
		}
		if (rnd() < 0.03) {
			txns.push({
				date,
				amount: koruny(rnd, 200, 1500),
				category: 'DARY',
				payee: pick(rnd, ['dárek', 'sbírka'])
			});
		}
	}

	// ── the monthly rows ─────────────────────────────────────────────────────
	//
	// Salary and the saving on every 15th/16th in range, including this
	// month's if it has come. The rent and Netflix only for the months *before*
	// this one: this month's are the schedules' to ask about.
	const thisMonth = monthKey(today);
	for (let month = monthKey(openingDate); month <= thisMonth; month = shiftMonth(month, 1)) {
		const on = (day: number) => `${month}-${String(day).padStart(2, '0')}`;
		const inRange = (date: IsoDate) => date >= openingDate && date <= today;

		if (inRange(on(15)))
			txns.push({ date: on(15), amount: SALARY, category: INCOME, payee: 'výplata' });
		if (inRange(on(16)))
			txns.push({ date: on(16), amount: SAVING, category: 'SPOŘENÍ', payee: 'spoření' });
		if (month < thisMonth) {
			if (inRange(on(1)))
				txns.push({ date: on(1), amount: RENT, category: 'BYDLENÍ', payee: 'nájem' });
			if (inRange(on(5)))
				txns.push({ date: on(5), amount: NETFLIX, category: 'LIFESTYLE', payee: 'Netflix' });
		}
	}

	// ── one of each rare thing ───────────────────────────────────────────────
	txns.push({
		date: addDays(today, -20),
		amount: minor(-12_490_00),
		category: 'BYDLENÍ',
		payee: 'pračka',
		isOneOff: true
	});
	txns.push({
		date: addDays(today, -2),
		amount: minor(-1_520_00),
		category: 'OSTATNÍ',
		payee: 'Shell',
		isProvisional: true
	});
	txns.push({
		date: addDays(today, -6),
		amount: minor(-1_840_00),
		category: 'JÍDLO',
		payee: 'večeře',
		shares: [{ who: 'Bea', amount: minor(920_00) }]
	});

	txns.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	return {
		openingBalance: minor(23_400_00),
		openingDate,
		txns,
		schedules: [
			{ payee: 'nájem', category: 'BYDLENÍ', amount: RENT, dayOfMonth: 1, mode: 'confirm' },
			{ payee: 'Netflix', category: 'LIFESTYLE', amount: NETFLIX, dayOfMonth: 5, mode: 'confirm' },
			{ payee: 'Spotify', category: 'LIFESTYLE', amount: SPOTIFY, dayOfMonth: 20, mode: 'auto' }
		],
		goal: {
			name: 'Rezerva',
			why: 'Tři měsíce výdajů, abych nemusel řešit, co když.',
			targetAmount: minor(150_000_00),
			targetDate: endOfMonth(shiftMonth(thisMonth, 9)),
			startAmount: minor(38_000_00),
			category: 'SPOŘENÍ'
		},
		holding: {
			name: 'Penzijko',
			kind: 'investment',
			valuations: [
				{ date: addDays(today, -60), value: minor(84_200_00) },
				{ date: addDays(today, -30), value: minor(86_900_00) },
				{ date: addDays(today, -1), value: minor(88_350_00) }
			]
		}
	};
}
