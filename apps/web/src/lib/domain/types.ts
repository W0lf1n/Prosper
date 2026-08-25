/**
 * The data model (PROJECT-PLAN §4).
 *
 * Client and server mirror each other. Every row carries the four sync fields —
 * `updatedAt`, `deviceId`, `isDeleted` and a client-generated id — from day one,
 * even though P1 has no server. Adding them later is a migration; carrying them
 * now is free.
 */

import type { Minor } from './money';
import type { IsoDate, IsoDateTime } from './datetime';

export type AccountKind = 'checking' | 'savings' | 'cash' | 'credit' | 'loan';

/**
 * Drives the Trimming law and the 10/10/10/70 split. Not cosmetic — this is what
 * the guidance layer reads.
 *
 * `give` is a DEVIATION from PROJECT-PLAN §6 — see DECISIONS.md, Q33. The book's
 * first allocation is money given away with nothing expected back, and it is a
 * class of its own: filed under `want` it disappears into the discretionary pile
 * and the one number that law is about cannot be read.
 */
export type SpendType = 'need' | 'want' | 'give' | 'save' | 'debt';

export type TxnSource = 'manual' | 'import-gpc' | 'bank-api' | 'recurring';

/** Fields every synced row carries. */
export interface Synced {
	updatedAt: IsoDateTime;
	deviceId: string;
	isDeleted: boolean;
}

export interface Account extends Synced {
	id: string;
	name: string;
	kind: AccountKind;
	openingBalance: Minor;
	openingDate: IsoDate;
	currency: string; // 'CZK' — unused in v1, present so multi-currency is not a migration
	isArchived: boolean;
	sortOrder: number;
}

export interface Category extends Synced {
	id: string;
	parentId: string | null; // one level of nesting, no deeper
	name: string;
	spendType: SpendType;
	monthlyCap: Minor | null; // null = untracked
	sortOrder: number;
	isArchived: boolean;
	/**
	 * DEVIATION from PROJECT-PLAN §4 — see DECISIONS.md, Q21.
	 *
	 * The plan's Category has no way to say "this one is income". Without it,
	 * every salary either lands in the uncategorised queue forever or gets a
	 * spendType that lies to the Trimming report. The entry screen uses this to
	 * show the right chips for the direction being entered.
	 */
	isIncome: boolean;
}

export interface Txn extends Synced {
	id: string;
	accountId: string;
	date: IsoDate;
	amount: Minor; // signed: negative = outflow
	categoryId: string | null; // null = lands in the uncategorised queue
	payee: string;
	note: string | null;
	transferPairId: string | null; // links the two legs of a transfer
	source: TxnSource;
	isCleared: boolean; // seen on a bank statement
	createdAt: IsoDateTime;
	/**
	 * DEVIATION from PROJECT-PLAN §4 — see DECISIONS.md, Q22.
	 *
	 * A one-off: the front door, the boiler service, the holiday. Counts towards
	 * the balance like everything else, but is excluded from "what does a month
	 * actually cost". In the spreadsheet a 41 890 Kč door sat in the same column
	 * as the groceries and dragged the yearly average with it.
	 */
	isOneOff: boolean;
	/**
	 * DEVIATION from PROJECT-PLAN §4 — see DECISIONS.md, Q25.
	 *
	 * Somebody else's share of this expense. You paid the whole thing, so the
	 * whole thing hits the balance; this only records that part of it is coming
	 * back. Nothing about it touches the balance until the money actually
	 * arrives and `settledByTxnId` points at the inflow that carried it.
	 *
	 * Positive magnitude, always less than or equal to the expense.
	 */
	owedAmount: Minor | null;
	owedBy: string | null;
	settledByTxnId: string | null;
	/**
	 * The schedule that produced this row — DECISIONS Q40. Null for anything
	 * typed by hand, which is most of the ledger.
	 *
	 * It is what lets the app tell "the mortgage went out" from "a payment that
	 * looks like the mortgage", which is the difference between a missing-payment
	 * check that is exact and one that is statistical.
	 */
	scheduleId: string | null;
}

/**
 * How a due payment reaches the ledger — DECISIONS Q40.
 *
 * `confirm` is the default and the honest one: the app offers the row and a tap
 * accepts it, so nothing enters the ledger that was not looked at. `auto` exists
 * because retyping a fixed mortgage every month is not awareness, it is data
 * entry — that decision was made once, years ago, and re-making it monthly
 * teaches nothing.
 */
export type ScheduleMode = 'confirm' | 'auto';

/**
 * A payment that repeats — a subscription, a standing order, a mortgage.
 *
 * A *declaration*, not a detection. `findMissingRecurring` infers repetition
 * from three months of history and can only ever be statistical; this row says
 * what is owed, to whom, out of which bucket and on which day, so a payment
 * that did not arrive is a fact rather than a guess.
 *
 * It never posts by itself while the app is closed — there is no server. The
 * catch-up runs on launch, the same way `closePreviousDay` does.
 */
export interface Schedule extends Synced {
	id: string;
	/** Goes into the payee field of every row it makes, and names it on screen. */
	payee: string;
	categoryId: string;
	/** Signed, like `Txn.amount`. The sheet takes the sign from the category. */
	amount: Minor;
	/** 1–31. Clamped into short months — the 31st of February is the 28th. */
	dayOfMonth: number;
	/** YYYY-MM. The first month it may post; never earlier than it was written. */
	startMonth: string;
	/** YYYY-MM, inclusive. Null is open-ended — most subscriptions are. */
	endMonth: string | null;
	mode: ScheduleMode;
	/**
	 * The last month this schedule was settled in, whether by posting a row or
	 * by being skipped. A watermark rather than a derivation: it makes the
	 * catch-up idempotent, and it means deleting a posted row does not bring it
	 * back on the next launch.
	 */
	lastPostedMonth: string | null;
	isArchived: boolean;
	sortOrder: number;
}

export interface Reconciliation extends Synced {
	id: string;
	accountId: string;
	date: IsoDate;
	statementBalance: Minor; // what the bank says
	computedBalance: Minor; // what the ledger says at that moment
	adjustmentTxnId: string | null;
}

export interface Goal extends Synced {
	id: string;
	name: string;
	why: string; // REQUIRED, min 10 chars — enforced, not a validation nicety
	targetAmount: Minor;
	targetDate: IsoDate;
	linkedAccountId: string | null;
	/**
	 * DEVIATION from PROJECT-PLAN §4 — see DECISIONS.md, Q26.
	 *
	 * Which bucket counts as putting money aside for this goal. `null` means
	 * every `save` category counts. Without it there is no way to tell progress
	 * from a balance, and a goal you cannot measure is the wish the law is about.
	 */
	categoryId: string | null;
	/**
	 * DEVIATION from PROJECT-PLAN §4 — see DECISIONS.md, Q27.
	 *
	 * The day the goal starts counting. Defaults to the first of the month it was
	 * written. Without it a new goal would open already part-funded by whatever
	 * happened to be in SPOŘENÍ, which is a different number from "what I have
	 * put aside for this".
	 */
	startDate: IsoDate;
}

/**
 * One month's written commitment towards a goal — the Targeting law's actual
 * mechanism (PROJECT-PLAN §2.2).
 *
 * The app can always *compute* what a month would have to carry to reach the
 * target on time. That number is a calculation. This row is a decision, and the
 * difference between the two is the whole point of the law: it exists only once
 * he has looked at the number and said yes to it.
 */
export interface MonthTarget extends Synced {
	id: string;
	goalId: string;
	month: string; // YYYY-MM
	amount: Minor; // positive magnitude to set aside that month
}

/**
 * What a holding is, and it is only ever the dot's colour.
 *
 * Liquid and semi-liquid only — DECISIONS Q38. A flat or a car is a number that
 * is true and useless: at six million it makes every other figure on the screen
 * disappear, and none of it can be spent this month.
 */
export type HoldingKind = 'cash' | 'savings' | 'investment' | 'crypto';

/**
 * Something owned whose value is *stated*, not derived — DECISIONS Q36.
 *
 * This is the one place in the app where a number comes from outside the
 * ledger. An account's balance is computed (`balanceOf`); a holding's value is
 * typed in by hand off a statement, and it is stale the moment after. The two
 * are separate tables so that difference is structural rather than a convention
 * somebody has to remember — see `docs/INVESTMENTS.md` I1.
 */
export interface Holding extends Synced {
	id: string;
	name: string;
	kind: HoldingKind;
	currency: string; // 'CZK' — unused in v1, same contract as Account
	/**
	 * Which bucket funds it. Unused in v1: contributions and growth are a later
	 * step, and Q37 already rules that two holdings sharing a category means the
	 * app shows no contribution figure for either rather than a split guess.
	 */
	categoryId: string | null;
	/** How often it is worth asking about. Per holding — a pension statement is
	    quarterly and a crypto wallet takes ten seconds, and one global interval
	    would nag hardest about the thing that cannot be answered. */
	reminderDays: number;
	isArchived: boolean;
	sortOrder: number;
}

/**
 * One reading of a holding, on a day.
 *
 * A series rather than a mutable `currentValue` column: a field would answer
 * "what is it worth" and lose both of the things that make the answer usable —
 * *when was that true*, which the reminder runs on, and *what did it do since*,
 * which is the only reason to open the screen twice. A wrong reading is soft
 * deleted like a wrong transaction; nothing here is edited in place.
 */
export interface Valuation extends Synced {
	id: string;
	holdingId: string;
	/** The day the value was true — not the day it was typed. */
	date: IsoDate;
	value: Minor; // positive magnitude
	note: string | null;
	/** Tie-breaks two readings entered for the same date. */
	createdAt: IsoDateTime;
}

/** Explicit "I spent nothing that day". Keyed by the date itself. */
export interface DayMark {
	date: IsoDate;
	deviceId: string;
	updatedAt: IsoDateTime;
}

export type SyncedEntity =
	| 'txn'
	| 'account'
	| 'category'
	| 'goal'
	| 'monthTarget'
	| 'reconciliation'
	| 'dayMark'
	| 'holding'
	| 'valuation'
	| 'schedule';

/** Client-only. Never synced, never sent. Populated from P2 onwards. */
export interface OutboxEntry {
	seq?: number; // autoincrement
	entity: SyncedEntity;
	entityId: string;
	payload: unknown; // full row, not a diff
	queuedAt: IsoDateTime;
	attempts: number;
	lastError: string | null;
}

/** Local key/value: device id, active account, schema bookkeeping. Not domain data. */
export interface MetaEntry {
	key: string;
	value: unknown;
}
