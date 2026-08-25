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

/** Explicit "I spent nothing that day". Keyed by the date itself. */
export interface DayMark {
	date: IsoDate;
	deviceId: string;
	updatedAt: IsoDateTime;
}

export type SyncedEntity =
	'txn' | 'account' | 'category' | 'goal' | 'monthTarget' | 'reconciliation' | 'dayMark';

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
