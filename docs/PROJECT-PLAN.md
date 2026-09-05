# Prosper — Project Plan

**Name:** Prosper · repository `Prosper`
**Owner:** Petr
**Status:** P0, P1 and **P2 (sync)** shipped. Targeting, investments, recurring
payments and P5 reporting shipped on top of P1. P3 designed, not built. The
14-day gate (§11) is running.
**Audience:** Claude Code (implementation), Petr (decisions)
**Last revised:** 2026-08-27

> This document describes the app **as it now stands**, not as it was first
> imagined. Where reality and the original plan disagreed, reality won and the
> reasoning is recorded here or in `DECISIONS.md`. Both are binding on future
> work.
>
> **Unfinished work is not listed here.** It lives in `TODO.md`, which is the
> only file in `docs/` that carries a backlog.

---

## 1. Purpose

Replace Excel-based expense logging with an offline-first PWA that:

1. Records a transaction in **under 5 seconds, one hand, no network**.
2. Produces a **reliable** ledger — reconciled against real bank balances, no
   silent gaps.
3. **Checks the work as it is entered**, because eight months of the real
   spreadsheet showed that the failure mode is not laziness, it is quiet
   miscategorisation that nobody notices until the numbers are meaningless.
4. Actively guides toward better financial behaviour, structured on the four
   laws from _The Four Laws of Financial Prosperity_ (Blaine Harris & Charles
   Coonradt).
5. Syncs to a server database when connectivity returns (P2).

The book is not decoration. It is the reason the app has opinions instead of
being a form over a database. §2 is the part of this document that matters most;
everything else exists to serve it.

---

## 2. The four laws — the spine of the product

Each law answers a different question, and each one has a mechanism in the app
rather than a page of advice. **A feature that serves no law is a feature this
project does not build.**

### 2.1 Tracking — _you cannot manage what you do not measure_

The first law is the whole reason entry has to take five seconds. A tracking
system that is any slower does not get used, and an unused system measures
nothing.

| Mechanism                                                                                                                                                                                      | Where                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| The app opens **directly into the numeric keypad**. No dashboard, no menu, no decision.                                                                                                        | `/`                                 |
| Whole koruny first: typing `249` means 249 Kč. Haléře only after an explicit comma.                                                                                                            | `domain/amount-input.ts`            |
| Three most-used buckets are one tap away; the rest are behind a search sheet.                                                                                                                  | `ui/CategoryPicker.svelte`          |
| Payee autocompletes from history, so the second "oběd" costs no typing.                                                                                                                        | `domain/ledger.ts` → `recentPayees` |
| Every day is materialised in the tape, including the ones nothing happened on. A day with no expense reads `bez výdaje`, as a statement rather than a hole.                                     | `domain/ledger.ts` → `buildTape`    |
| A forgotten day is fixed by typing the row with its date, days later if need be. Nothing has to be cleared first.                                                                              | `/` → the date sheet                |
| The month says how many days cost nothing — a figure off the ledger alone, with no second signal to maintain.                                                                                  | `domain/coverage.ts`                |

**The original spreadsheet had no dates at all** — only which month sheet a row
sat on. Tracking was, strictly speaking, impossible. That single observation
justifies most of this section.

Three of these rows are new on 2026-08-28 and they replace three that asked the
person to confirm an absence: an explicit `DayMark`, a launch step that closed
off yesterday, and a `coverage` check that called an unmarked day a hole. An
empty day is now simply a day nothing was spent on. What that cost is written
down in `DECISIONS.md` → "Every empty day is a no-spend day".

### 2.2 Targeting — _unwritten goals are wishes_

Shipped 2026-08-24, ahead of its phase, because it was the only one of the four
laws with no mechanism at all.

| Mechanism                                                                                                                                                                                                                                                                    | Where                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A `Goal` cannot be saved without **all three** of: a why (min 10 chars), an amount, and a date. The refusal is the mechanism, not a validation nicety — the save button names the missing piece rather than accepting the tap and complaining.                               | `domain/goals.ts` → `validateGoal`, `/cil`                         |
| **The month is the horizon anybody acts on.** A `MonthTarget` is one month's written commitment. The app can always _compute_ what the month has to carry; that number becomes a target only once he says yes to it, and the screen shows which of the two it is looking at. | `domain/types.ts` → `MonthTarget`, `db/repo.ts` → `setMonthTarget` |
| The goal is on the launch route, permanently: a card on Domů with this month's figure and its meter, and the same card again on Já. | `/` and `/ja` |
| Progress is read off the ledger that already exists — money that landed in the goal's bucket, nothing else. No second set of books, which is the only reason it can be trusted.                                                                                              | `domain/goals.ts` → `contributions`                                |
| Saving into the goal's bucket makes the confirmation say where the month now stands. The cheapest place to put a target in front of somebody is the half-second after they moved towards it.                                                                                 | `/` → `goalLine`                                                   |
| `SPOŘENÍ` is its own bucket, and is what a new goal points at by default. In the spreadsheet, "dlouhodobá investice" — 2 000 Kč every month without fail — was buried inside OSTATNÍ, so the one number this law needs could not be read.                                    | `db/seed.ts`, `domain/goals.ts` → `defaultGoalCategory`            |
| Required monthly contribution, computed exactly and **rounded up** — a number that lands a few haléře short every month misses the date.                                                                                                                                     | `domain/goals.ts` → `requiredMonthly`                              |
| The record of months, ✓ or ✗ against the number he committed to. This is where Targeting turns into Training.                                                                                                                                                                | `domain/goals.ts` → `monthHistory`                                 |
| The month's net is the first thing on screen, every launch — the hero of Domů. | `/` |

### 2.3 Trimming — _"necessary" expenses expand to match income_

Trimming is impossible when spending hides in the wrong bucket, so most of this
law is enforced at entry time rather than at review time.

| Mechanism                                                                                                                                                                                                                     | Where                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Every category carries a `spendType`: `need` / `want` / `give` / `save` / `debt`. This is what both splits read; it is not cosmetic.                                                                                          | `domain/types.ts`                                  |
| Groceries (`POTRAVINY`, need) are separated from eating out (`JÍDLO`, want) — the discretionary half is the half you can act on.                                                                                              | `db/seed.ts`                                       |
| A description that looks like another bucket raises a one-tap correction **before** the row is saved.                                                                                                                         | `checks.ts` → `misfiled`                           |
| `OSTATNÍ` is watched: once it passes 15 % of the month's recurring outflow, the app says so — **and the finding opens the month's rows in that bucket, largest first, each with the bucket the vocabulary would move it to.** | `checks.ts` → `other-overflow`, `domain/refile.ts` |
| One-off spending is separated from the running cost of a month, so a single purchase cannot flatter or ruin the average.                                                                                                      | `Txn.isOneOff`, `/prehled`                           |
| A vague description on a large amount is challenged while it can still be fixed.                                                                                                                                              | `checks.ts` → `vague`                              |
| The **10 / 10 / 10 / 70 split**, measured against income rather than outflow — a share of outflow always sums to 100 % and can never say whether more went out than came in. Two rings: what you did, and what the book says. | `domain/prosperity.ts`, `/prehled`                   |
| `give` is a spend type of its own. Money given away with nothing expected back is not a want, and filed as one it vanishes into the discretionary pile.                                                                       | `domain/types.ts` — DECISIONS.md Q33               |
| A recurring payment can be **declared** — what is owed, to whom, out of which bucket, on which day, and how much of it somebody pays back — with its annual cost, net, where it is set.                                       | `domain/recurring.ts`, `/prehled`                   |

**Evidence this law needed teeth:** 25 286 Kč of food was filed under BYDLENÍ,
LIFESTYLE, DARY and PROJEKTY across eight months while JÍDLO reported 13 083 Kč.
The most controllable category in the book was under-reported threefold.

The law has enforcement and a target _shape_. It still has no _cap_ —
`Category.monthlyCap` is in the schema and null on every row. The design is in
`TRIMMING-AND-TRAINING.md` T2; the outstanding work is in `TODO.md` §4.2.

### 2.4 Training — _repetition until it is a habit_

| Mechanism                                                                                                                 | Where                                |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| The checks run on **every keystroke** of every entry. Training is not a monthly event; it is a hundred small corrections. | `checks.ts` → `checkDraft`           |
| Nothing a check says ever blocks a save. A system that punishes recording is a system that stops being used.              | `checks.ts` (contract)               |
| A subscription seen in each of the last three months but missing from this one becomes a question.                        | `checks.ts` → `findMissingRecurring` |
| The record of months against a written target — ✓ or ✗, four in a row being the book's actual claim about training.       | `/cil` → `monthHistory`              |
| Undo on every save.                                                                                                       | `ui/Toaster.svelte`                  |

This is still the least finished of the four laws, though less so: the ring and
the streak shipped 2026-08-27, and both changed meaning on 2026-08-28 — they
count days without an expense now, not days recorded. The monthly close ritual and the nudge
are designed in `TRIMMING-AND-TRAINING.md` and not built. The **health score is proposed for rejection** (R4): a single compounded
number is uninterpretable when it moves, which is the one thing a training
signal must never be.

---

## 3. Success criteria

| Metric                                                    | Target               | Actual                                                          |
| --------------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| Time from home screen tap to saved transaction            | ≤ 5 s                | 3 actions: type, tap bucket, save — **untimed on a real phone** |
| Cold start to interactive (mid-range Android, cache warm) | ≤ 1 s                | not yet measured on device                                      |
| JS bundle, brotli, entry route                            | ≤ 150 kB             | **80.4 kB**                                                     |
| CSS, brotli, entry route                                  | —                    | 9.5 kB                                                          |
| Self-hosted fonts                                         | —                    | 96.9 kB, cached once, offline-safe                              |
| Days-covered                                              | _struck 2026-08-28_  | no longer measurable, and no longer a question — see below      |
| Reconciliation delta vs bank, month end                   | 0 Kč                 | pending (P3)                                                    |
| Still in daily use                                        | month 3              | **the real metric**                                             |

Excel failed on friction, not features. Every design decision defers to entry
speed. The two unmeasured rows are tracked in `TODO.md` §3.

**Days-covered was struck rather than missed.** It measured days carrying a
record against days elapsed, and it could only tell a frugal Tuesday from a
forgotten one because the app asked for a tap to say which. That tap is gone
(`DECISIONS.md` → "Every empty day is a no-spend day"), so the metric would read
100 % for ever. Tracking is now judged by what it is for: whether the expenses
that happened are in the book.

### Non-goals (v1)

- Multi-user / household sharing
- ~~Investment portfolio tracking, net worth~~ — **partly reversed, Q36.** Hand-typed
  holding values and a `celkem` figure shipped 2026-08-25; see `INVESTMENTS.md`.
  Tickers, units, cost basis and any kind of price feed stay out
- Tax reporting, invoicing, business accounting for the 3D printing side business
- Automatic categorisation via ML — the vocabulary in `domain/vocabulary.ts` is
  a hand-written dictionary of Petr's own words, and that is deliberate
- Native app stores
- Anything requiring a Mac

---

## 4. Settled decisions

Full reasoning, including every rejected alternative, is in `DECISIONS.md`.

|                | Decision                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| Frontend       | **SvelteKit 2.63 + Svelte 5.56** (runes forced), Vite 8, TypeScript 6 strict     |
| Client storage | **Dexie 4.4.5**, schema **v6** behind a migration array                          |
| Money          | `number` in minor units (haléře), branded `Minor`, all arithmetic in one module  |
| Ids            | Client-generated **UUIDv7**, hand-rolled, no dependency                          |
| Hosting        | Static output (`adapter-static`), served by its own nginx container from the API's origin — `deploy/`, runbook in `DEPLOYMENT.md` |
| UI language    | **Czech.** Code, identifiers, comments and docs stay English                     |
| Currency       | One account per currency since Q50 (CZK, EUR, USD, GBP); never summed across, no rates; koruny held elsewhere join the CZK account as pockets |
| Phone          | Android primary; iOS kept working as a degraded case                             |
| History import | **None.** Clean start — the 2026 workbook has no dates to import                 |
| Repository     | `github.com/W0lf1n/Prosper`, public, **MIT**                                     |
| Backend / sync | ASP.NET Core 10 + Postgres 16, hand-rolled outbox + LWW — **written**, `apps/api` |

### The workbook

`Výdaje 2026.xlsx` — eight months, 547 rows — is the primary source for the
category set, the check vocabulary, and every rule in `domain/checks.ts`. The
full analysis, including the eight distinct failure modes it exhibited, is in
`DECISIONS.md` under "The workbook". Read it before changing a check.

---

## 5. Architecture

```
┌──────────────────────── PHONE ───────────────────────────────┐
│  SvelteKit PWA (installed to home screen)                    │
│                                                              │
│  ┌─────────────┐   ┌──────────────┐   ┌───────────────────┐  │
│  │ UI (Svelte) │──▶│ domain layer │──▶│ Dexie / IndexedDB │  │
│  │  6 screens  │   │  PURE, no IO │   │ txns, categories, │  │
│  └─────────────┘   │  283 tests   │   │ holdings, OUTBOX  │  │
│         │          └──────────────┘   └─────────┬─────────┘  │
│         │                  │                    │            │
│         │          ┌───────▼────────┐           │            │
│         └─────────▶│  checks.ts     │           │            │
│      every keystroke│ the four laws │   sync engine (P2)     │
│                    └────────────────┘           │            │
│  ┌──────────────────┐                           │            │
│  │ service worker   │                           │            │
│  │ (app shell cache)│                           │            │
│  └──────────────────┘                           │            │
└─────────────────────────────────────────────────│────────────┘
                                                  │ HTTPS, JWT (P2)
                                                  ▼
┌──────────────── VPS (Docker) — deploy/ ──────────────────────┐
│  nginx (host, TLS)  →  127.0.0.1:8080                        │
│      │                                                        │
│      ▼                                                        │
│  web   nginx + static PWA, location /api/ ──┐                │
│                                             ▼                 │
│                     api  ASP.NET Core 10  →  db  Postgres 16  │
│                                        nightly pg_dump → disk │
└──────────────────────────────────────────────────────────────┘
```

**Client and API are one origin**, because the `web` container proxies `/api/`
to the `api` container. That is what retires the CORS allowlist, what lets
Settings prefill the pairing address, and why only one port is published — bound
to `127.0.0.1`. The runbook is `DEPLOYMENT.md`.

**Client is the source of truth for authoring. Server is durable storage and a
cross-device merge point.** The app must be fully functional with the server
permanently down, and stays that way: a device that has never been paired never
queues a row and never makes a request.

---

## 6. Data model

Client and server mirror each other. Client TS shown; server mirrors in C# with
`long` for money. The authoritative version is `domain/types.ts`.

```ts
// All ids are client-generated UUIDv7 (time-sortable). Server never assigns ids.
// All money is integer minor units (haléře). Signed: negative = outflow.

type Minor = number & { __brand: 'minor' };

type AccountKind = 'checking' | 'savings' | 'cash' | 'credit' | 'loan';
type SpendType = 'need' | 'want' | 'give' | 'save' | 'debt'; // `give`: Q33
type TxnSource = 'manual' | 'import-gpc' | 'bank-api' | 'recurring';
type ScheduleMode = 'confirm' | 'auto';
type HoldingKind = 'cash' | 'savings' | 'investment' | 'crypto';

/** Fields every synced row carries, from day one. */
interface Synced {
	updatedAt: string; // ISO datetime, client clock
	deviceId: string;
	isDeleted: boolean; // soft delete only, always
}

interface Account extends Synced {
	id: string;
	name: string;
	kind: AccountKind;
	openingBalance: Minor;
	openingDate: string;
	currency: string; // per account since Q49 — immutable once the account has rows; one account per currency since Q50
	pockets: AccountPocket[]; // money from elsewhere in this currency, opening the account — Q50, v12
	isArchived: boolean;
	sortOrder: number;
}

/** A named amount that opened the account from somewhere else — "Revolut · 5 000 Kč".
    Opening money, not a live balance; never restated. Read through `pocketsOf()`. */
interface AccountPocket {
	id: string;
	name: string;
	amount: Minor; // positive, in the account's currency
}

interface Category extends Synced {
	id: string;
	parentId: string | null; // one level of nesting, no deeper
	name: string;
	spendType: SpendType; // drives Trimming — not cosmetic
	monthlyCap: Minor | null; // null = untracked (P3)
	sortOrder: number;
	isArchived: boolean;
	isIncome: boolean; // DEVIATION — DECISIONS.md Q21
}

interface Txn extends Synced {
	id: string;
	accountId: string;
	date: string; // ISO date, local, no timezone games
	amount: Minor; // signed
	categoryId: string | null; // null only for legacy rows — see §6.1
	payee: string; // the spreadsheet's `popis`
	note: string | null;
	transferPairId: string | null;
	source: TxnSource;
	isCleared: boolean;
	createdAt: string;

	isOneOff: boolean; // DEVIATION — DECISIONS.md Q22
	shares: TxnShare[]; // who pays parts back — DECISIONS.md Q25, Q47
	scheduleId: string | null; // DECISIONS.md Q40 — null for anything hand-typed
}

/** One person's slice of an expense that is coming back — Q25 made plural by
    Q47. Each settles on its own. Pre-v9 rows carry the old single
    `owedAmount` / `owedBy` / `settledByTxnId` trio instead; `sharesOf()` in
    `domain/receivables.ts` reads both shapes and is the only reader. */
interface TxnShare {
	id: string; // unique within its row
	who: string; // '' = unnamed
	amount: Minor; // positive; together never more than the expense
	settledByTxnId: string | null;
}

/** A payment that repeats: a declaration, not a detection. Q40. */
interface Schedule extends Synced {
	id: string;
	accountId: string; // which account it posts from — Q49
	payee: string;
	categoryId: string;
	amount: Minor; // signed
	dayOfMonth: number; // 1–31, clamped into short months
	startMonth: string; // YYYY-MM
	endMonth: string | null; // null = open-ended
	mode: ScheduleMode; // default 'confirm'
	shares: ScheduleShare[]; // the slices that come back — Q46, Q47; TxnShare
	//                          minus the settlement, copied onto every posted row
	lastPostedMonth: string | null; // a watermark, not a derivation
	isArchived: boolean;
	sortOrder: number;
}

interface Reconciliation extends Synced {
	id: string;
	accountId: string;
	date: string;
	statementBalance: Minor; // what the bank says
	computedBalance: Minor; // what the ledger says
	adjustmentTxnId: string | null;
}

interface Goal extends Synced {
	// Targeting law
	id: string;
	name: string;
	why: string; // REQUIRED, min 10 chars — enforced
	targetAmount: Minor; // REQUIRED
	targetDate: string; // REQUIRED
	linkedAccountId: string | null;
	categoryId: string | null; // DEVIATION — DECISIONS.md Q26
	startDate: string; // DEVIATION — DECISIONS.md Q27
	startAmount: Minor; // the stated head start, signed — DECISIONS.md Q48
}

interface MonthTarget extends Synced {
	// one month's written commitment
	id: string;
	goalId: string;
	month: string; // YYYY-MM
	amount: Minor; // positive magnitude
}

/** Something owned whose value is *stated*, not derived. Q36. */
interface Holding extends Synced {
	id: string;
	name: string;
	kind: HoldingKind;
	currency: string; // 'CZK'
	categoryId: string | null; // which bucket funds it — unused in v1, see Q37
	reminderDays: number; // per holding: a pension is quarterly, a wallet is not
	isArchived: boolean;
	sortOrder: number;
}

/** One reading of a holding, on a day. A series, never a mutable column. */
interface Valuation extends Synced {
	id: string;
	holdingId: string;
	date: string; // the day the value was true, not the day it was typed
	value: Minor; // positive magnitude
	note: string | null;
	createdAt: string; // tie-breaks two readings on the same date
}

interface DayMark {
	// explicit "I spent nothing today". NOTHING WRITES ONE since 2026-08-28 —
	// an empty day is a no-spend day. Kept: rows exist on the device and on the
	// server, and dropping a synced entity is a protocol change.
	date: string; // PK
	deviceId: string;
	updatedAt: string;
}

interface OutboxEntry {
	// client-only, never synced. Idle until P2.
	seq?: number;
	entity: SyncedEntity; // txn | account | category | goal | monthTarget
	//                       | reconciliation | dayMark | holding | valuation | schedule
	entityId: string;
	payload: unknown; // full row, not a diff
	queuedAt: string;
	attempts: number;
	lastError: string | null;
}

/** Local key/value: device id, active account. Not domain data, never synced. */
interface MetaEntry {
	key: string;
	value: unknown;
}
```

### 6.1 Invariants

- **Soft delete only.** `isDeleted` is never un-set by a sync merge. (A local
  undo immediately after a delete is a different thing and is allowed.)
- **A transaction must have a category.** The UI offers no way to save without
  one; `categoryId` stays nullable only so pre-existing and future imported rows
  can be represented and then fixed. See §6.2.
- **Transfers are two rows**, mutually referencing `transferPairId`. Never
  one row. With one account per currency every transfer is an exchange, and
  since 2026-09-02 the legs count the way they read: the outgoing leg is an
  expense from a bucket chosen in the sheet, the incoming leg is income in
  `SMĚNA` — one income bucket under a constant id, created on first use.
  The two amounts are the only rate the app knows; deleting either leg
  removes both (`DECISIONS.md`, "An exchange counts the way it reads").
- **Every transaction belongs to an account.** No orphans.
- **An outstanding share is not money.** A share never touches the balance or
  any total until it is settled and its `settledByTxnId` points at the inflow
  that carried it — and each share settles alone (Q47): one friend paying up
  says nothing about the other.
- **An inflow filed under a spending bucket is a refund**, and nets against that
  bucket rather than counting as income.
- **Goal progress is read off the ledger, never stored** — with one stated
  exception. A contribution is an ordinary outflow into the goal's bucket;
  there is no second set of books, and that is the only reason the progress
  figure can be trusted. `startAmount` (Q48) is the exception, on the same
  terms as a holding's valuation: a value that moved without a transaction,
  typed by hand, added to — never replacing — what the ledger measures.
- **A computed monthly figure is not a target.** `MonthTarget` exists so the
  number he agreed to is distinguishable from the number the app worked out. The
  screen says which one it is showing.
- **A valuation is not a transaction.** It never reaches `income`, `outflow`,
  `net`, `recurringOutflow`, any `BucketTotal`, or `prosperitySplit`.
  `summariseMonth` does not take holdings as input and must not be given them.
- **Unrealised growth is not income.** Money from a holding enters the ledger
  only when it is actually sold, as an ordinary inflow.
- **Current value is the latest live reading, chosen in one place.**
  `currentValuation()` is the only function allowed to pick it.
- **A value is never shown without its date once it is older than its holding's
  cadence** — including inside `celkem`, which names the oldest reading it rests
  on.
- **A day with no expense on it is a day without an expense.** Nothing has to
  be tapped to say so, and a forgotten day is fixed by typing the row. What the
  month reports is how many days cost nothing, measured against days **elapsed**,
  never days in the month — otherwise the 3rd is a verdict on 28 days that have
  not happened.
- **A schedule's declared share is a property of the payment, not a second
  payment.** It rides onto every row the schedule posts, it never changes the
  amount that leaves the account, and it is clamped to the row it is on.
- **A reconciliation delta is a missing transaction, not an error.** The bank is
  right about the balance and the ledger is right about the reasons. The fix is
  an ordinary row; the balance is never overwritten, and there is no tolerance —
  nine haléře out is still out.
- **`Schedule.lastPostedMonth` is a watermark, not a derivation.** Posting is
  therefore idempotent, deleting a posted row does not resurrect it on the next
  launch, and "we skipped July" is expressible at all.
- `updatedAt` uses the client clock. Acceptable: single user, LWW, clock skew
  between one person's own devices is seconds.
- Categories are archived, never hard-deleted, while transactions reference them.
- **IndexedDB cannot index booleans**, so `isDeleted` / `isArchived` / `isOneOff`
  are stored but not indexed, and filtered in memory.

### 6.2 A deliberate reversal: no uncategorised queue

The original plan said fast entry means the category is often skipped, that this
is correct and intended, and that an uncategorised queue is the price.

**That was overruled on 2026-08-23.** A category is now mandatory: the Save
button reads _"Vyber kategorii"_ until one is chosen, tapping a selected chip no
longer clears it, and the picker offers no "bez kategorie" row.

The trade: one guaranteed tap per entry, against never having a queue to drain.
It survives because the three most-used buckets are already on screen, so the
tap is usually the one the thumb was heading for anyway. The
`uncategorised` check and the nullable column remain, for legacy and imported
rows only.

---

## 7. The checks

`domain/checks.ts` — pure, and covered by the 203 tests across the domain layer.
Every rule exists because the spreadsheet already went wrong that way, and each
carries the figure from the workbook in a comment so nobody later deletes it as
theoretical.

**Contract: no check ever blocks a save.** A check that stops you recording an
expense is worse than the mistake it prevents.

### While typing — `checkDraft`

| Rule               | Catches                                                      | From the workbook                            |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------- |
| `misfiled`         | Description matches a different bucket; offers it in one tap | 25 286 Kč of food outside JÍDLO              |
| `unclear-number`   | Description carries a number that is not the amount          | "Netflix - 379" recorded as 74 Kč            |
| `vague`            | A large amount with a description that explains nothing      | "opak. obj", 17 074 Kč in one month          |
| `one-off`          | A large expense not yet marked extraordinary                 | a 41 890 Kč front door in with the groceries |
| `refund-as-income` | An inflow that is really somebody paying you back            | "Zůza - bydlení plyn" booked as income       |
| `duplicate`        | Same amount and description within three days                | HBO Max entered as −18 Kč, twice             |

### At month level — `summariseMonth`

| Rule                | Catches                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `other-overflow`    | OSTATNÍ past 15 % of _recurring_ outflow — measured against recurring so a one-off cannot hide it |
| `uncategorised`     | Legacy rows with no bucket                                                                        |
| `overspend`         | The month spent more than it earned                                                               |
| `missing-recurring` | A subscription present in the last three months and absent from this one                          |

Four of the workbook's eight months ran a deficit — LEDEN −23 355, BŘEZEN −238,
KVĚTEN −45 937, ČERVENEC −10 048 — and no screen he looked at ever said so.

---

## 8. Screens

Five tabs and three detail screens, since the third edition of the design
(2026-09-05). The bar reads **Domů · Výpis · ⊕ · Přehled · Já**. The disc in the
middle opens `/zapis`, which carries no bar of its own — the keypad owns the
bottom of the phone there, and `✕` returns to whatever screen opened it. `/cil`,
`/jmeni` and `/nastaveni` are reached from Já as cards and keep that tab lit
while they are open; each wears a back chevron. `/mesic` and `/platby` redirect
into `/prehled`, so a phone that still has them in its history lands somewhere.

The bar was six cells around a disc until this edition, and at its ceiling. Two
pairs of screens turned out to be two halves of one question — the month and the
standing orders are the same month from two sides, and the goal, the wealth and
the settings are all "about me" — so they became one screen with a switch and
one hub with cards, and the keypad moved off the launch route so the launch
route could say how the month stands.

### `/` — Domů (the launch route)

```
┌────────────────────────────────────┐
│ Září 2026                     [⚙]  │  ← the month · sliders → /nastaveni
│                                    │
│           Zůstatek měsíce          │
│           +4 015,50 Kč             │  ← the month's net, 44 px
│      [↑ 59 400,00] [↓ 55 384,50]   │
│ [  Zapsat  ] [ Výpis ] [ Měsíc ]   │  ← the primary pill → /zapis
│ ┌ K potvrzení ─────────────── ● ┐  │  ← only while a confirm schedule is due
│ │ (⌂) Internet · BYDLENÍ · dnes  │  │
│ │ [ Potvrdit ] [ Přeskočit ]     │  │
│ └────────────────────────────────┘  │
│ ┌ Cíl · Rezerva ── měsíc splněn ─┐  │  → /cil
│ │ 5 000,00 Kč    z 5 000,00 Kč   │  │
│ │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬ │  │
│ └────────────────────────────────┘  │
│ ┌ Jmění celkem ─────────────── › ┐  │  → /jmeni
│ ┌ Poslední záznamy ─ Zobrazit vše┐  │  → /tape · last three rows, every account
│ │ (◔) Bolt        LIFESTYLE · Včera │
├────────────────────────────────────┤
│  Domů    Výpis   (⊕)  Přehled  Já  │
└────────────────────────────────────┘
```

The month's standing is the first thing visible, every launch — the answer to
"how am I doing" before anything is tapped. The figure is the active account's
month (Q49); the two pills under it are what came in and what went out.

Everything that used to be a glyph in a header slab is a card here: what the
standing orders are waiting on, with Potvrdit and Přeskočit under each row
(`ui/DueCard.svelte`, tapping the row first when the amount needs correcting);
the goal's month, with its meter and a badge when the month is met or behind;
the wealth total with its two halves; and the last three rows of the ledger
across every account, each with its bucket's circle.

### `/zapis` — Zápis (the record screen)

```
┌────────────────────────────────────┐
│ (✕)       [ Výdaj │ Příjem ]       │
│ ┌ (Kč) Běžný účet · CZK  60 369,50┐│  ← the account rail (Q50): swipe = switch
│ └──────────────────────────────────┘│     · · ·
│                Výdaj               │
│             249  (Kč ▾)            │  ← 56 px; the button cycles accounts
│                                    │
│ [(🛒) POTRAVINY] [(🍴) JÍDLO] [(⌂)…│  ← ranked, every bucket, search at the end
│ [ dnes ] [ komu / za co          ] │
│ (○) mimořádný výdaj     dluží mi › │
│ ● Spíš JÍDLO?             [JÍDLO]  │  ← live check, one-tap fix
│      1        2        3           │
│      4        5        6           │  ← 56 px keys, transparent, lit on press
│      7        8        9           │
│      ,        0        ⌫           │
│ [            Uložit             ]  │
└────────────────────────────────────┘
```

The direction is a segmented pill in the header; Příjem preselects the one
income bucket when there is exactly one. The account is the rail under it: one
card per account with its colour, its code and its balance, snapping one at a
time, and the selected card is the account the row is written to and the
currency the amount is in. Sticky, like the date — the same meta write Settings
makes, so every other screen follows (Q50). The currency beside the amount is
text, not a control: the rail is the switch (Q56).

Below the amount: the bucket rail (every category, most-used first, a coloured
circle on each), the date pill and the payee field, the two rare properties on
an outflow, and the live check strip with its one-tap fix. Nothing here blocks a
save; the pill dims and reads _Vyber kategorii_ until there is a bucket.

On save the screen goes home and the toast says what was written — _−410,00 Kč
· JÍDLO · Restaurace_ — with Zpět on it. The date survives the save, so several
rows for one back-filled day are typed without re-picking it.

### `/tape` — Výpis

The account's balance on a card at the top, then the ledger newest first: a
month row with its two figures, and under it one card per day with the day's
name and net above it. Every row is the bucket's circle, the payee (or the
bucket's name), the bucket underneath, the signed amount and the running
balance. A day with nothing on it is one row reading `bez výdaje` behind a teal
check. Tap a row to edit or delete.

**A month folds.** Its row is the control, and folded it still carries the two
figures that decide whether to open it. Which months are shut is remembered in
`meta`, per device, because a fold that resets on every launch buys nothing.

The balance card carries **Srovnat s bankou** and how long it has been since it
was last done, and **Převod mezi účty** once there is a second account. The
reconcile sheet shows the ledger's figure first and unprompted, takes the
statement's figure under it, and computes the difference as you type.

**Dluží mi is on the row.** The edit sheet of an outflow carries the whole of
its receivable: mark it received, change the share, change who owes it, add a
second person, or clear it. Přehled keeps the list of everything outstanding —
that is the report — but the action lives where the app shows you the debt.

**A difference is offered as a row to write, never as a balance to overwrite.**
The adjustment is one-off by construction. The quieter second option — record
the disagreement and write nothing — is the right answer when the difference is
a card payment that has not cleared.

### `/prehled` — Přehled: Měsíc | Platby

One title row — _Přehled_ and the month switcher — and a full-width segmented
pill under it. The month view keeps its own account chips (Q49): per-account is
a month in that account's currency with everything the screen knows how to say;
_vše_ lays the currencies side by side and never adds them up.

**Měsíc** is the workbook's `SUMA` sheet, rebuilt, in this order: the net with
_Přišlo_ and _Odešlo_ as two tiles and the one-off figure separated from the
running cost; **Dny bez výdaje** — a ring of days that cost nothing against
days _elapsed_, and the current run; the **Kontrola** card listing the month's
findings, each with its fix where one exists; **Dluží mi** — everything
outstanding, with a one-tap _Přijato_; **Rozdělení příjmu** — the 10/10/10/70
split as one ring with the remainder in its centre and, beside it, each class
with its share and its distance from the mark; and **Kam to šlo**, buckets
ranked by spend, each with its circle and a meter in its own colour. The second
ring — the book's shape — went with this edition; the label carries the four
numbers and the deltas carry the comparison.

**Platby** is the standing orders and what they cost: the same _K potvrzení_
card as Domů, the **net year** with the month's figures under it, **Odchází** —
every declared outflow with its day, its bucket, its mode as a badge, and either
the payments left or the share somebody pays back — and **Přichází**, money that
turns up every month on its own, declared the same way on an income category.

### `/ja` — Já

The hub. A title — there is no name and no avatar (Q55) — and three cards: **Cíl** with the goal's total and its meter, **Jmění** with the
total and how many readings have gone stale, and **Nastavení** as a list of the
five sections, each opening `/nastaveni` at that section.

### `/cil` — Cíl

The Targeting law, in three parts and that order: **the why** in his own words
in a recessed slab, before any number; **this month's** figure, with a one-tap
_Odložit_ that writes the ordinary outflow; and **the record of months**, ✓ or
✗ in a coloured mark against the figure that month was aiming at.

**The month's number writes itself.** `catchUpGoalTargets` puts it there on
launch — remaining ÷ months left — so the record means something without a
monthly ritual in front of it. `Upravit cíl měsíce` is what survived of the old
confirm step, because "this month I can do 2 000, not 4 500" is a decision.

**Which goal reaches Domů is chosen.** `mít na očích` pins one, and a pin beats
the nearest-deadline guess absolutely — including for a goal that is finished or
overdue, because that is exactly the goal somebody wants kept in front of them.

The form is the refusal: the save button reads _"Napiš proč"_ until the why
clears ten characters, _"Zadej termín"_ until the date is in the future. This is
the one place in the app where something blocks a save.

### `/jmeni` — Jmění

_Celkem_ at 40 px, centred; under it two half-width cards — _Na účtu_ and _V
investicích_ — and one more per foreign currency, standing beside the total
rather than inside it (Q49). Then one card per reading that has gone stale, with
_Přepsat hodnotu_ opening the keypad on that holding; then the holdings as rows
— a circle with a short code in the kind's colour, the name, the day the value
was true with what was put in, the value and what it did — and _Přidat
investici_ under them.

**Adding a holding is one sheet** (Q51): the name, what it is worth today, what
it is, and after how many days to remind. Left blank, the value is asked on the
keypad straight afterwards.

**Everything about a holding is on this screen**, in two sheets that hand over
to each other: `ValuationSheet` is the number, and `Upravit investici` inside it
opens `HoldingSheet` — the name, the kind, the cadence, the bucket that feeds it,
and archiving.

Below it, a line that has to stay there: the values are what you copied off a
statement, nothing is fetched, and growth is neither income nor part of the
month's split.

### `/nastaveni` — Nastavení

Five cards, each with an anchor the rows on Já point at. **Účty**: every live
account with what is on it right now, by currency, the pockets that joined it
(Q50) indented under it; _Přidat účet_ for a currency not yet held, _Upravit_
for the opening figures and the pockets, _Převod_ once there are two; tapping an
account that is not the active one makes it the account the keypad writes to.
**Kategorie**: one row per bucket with its circle, its type and a chevron —
tapping opens the editor (`ui/CategorySheet.svelte`): name, type, ten colours,
thirty-two icons, and archiving; colour and icon apply live, everywhere the
bucket appears. _Nová kategorie_ opens the same sheet empty. **Vzhled**: systém
/ světlý / tmavý. **Synchronizace**: pairing, or the last cycle to the minute.
**Data**: the JSON backup out and in, the spreadsheet, the counts, and **Začít
znovu** — the app's only destructive action, behind a typed phrase and a backup
ticked by default (`resetLedger` in `repo.ts`, `domain/reset.ts` for the phrase).

**One account per currency** (Q50). Koruny on another card are a *pocket* on the
CZK account — a name and an amount that opened it. The switch between accounts
lives on the record screen's rail as well as here, and the ground of every
screen takes the colour of a foreign currency so the account being written to
is known before a digit is typed.

## 9. Design

The third edition, delivered 2026-09-05 as a high-fidelity handoff
(`docs/redesign/…/design_handoff_prosper_revolut/README.md`) and applied as
specified: a consumer-banking layout in the manner of Revolut. A soft-grey
ground, white cards with 20 px corners and no shadow, one proportional sans at
three weights, every button a pill, every bucket a coloured circle with an icon
in it, and a five-slot bar with a record disc in the middle. Tokens live in
`lib/styles/tokens.css` and that is the only place a colour is defined; the
reasoning behind each move is in `DECISIONS.md` under the third edition.

**Light first.** The default is the light theme; dark — a black ground with
near-black cards — is the system preference or the explicit choice. Both are
declared twice, once for `prefers-color-scheme` and once for `[data-theme]`, so
the toggle wins in both directions, and an explicit choice moves `color-scheme`
with it.

**A sheet has no close button.** It is pulled down by its grip, dismissed by
tapping the dimmed app behind it, or by Esc. A sheet that commits something
carries its own primary pill, and that pill closes it on the way out — a commit
is not a close control.

### The colour rules

The values are **not restated here** — `tokens.css` is the single source and
carries the charter in its header. What is binding are the roles:

- **The primary pill inverts**: ink on white by day, white on black by night. It
  is the primary action, the selected segment, the selected chip.
- **`--signal` (cobalt) is the accent**: the record disc, links, the goal's
  meter, a toggle that is on. Never decoration, and never a data colour —
  the one exception is the category palette, which the person picks, and which
  happens to contain the same cobalt under its own name.
- **Mint (`--in`) is money coming in, and a money verdict that came out right** —
  a met month, a day that cost nothing, a passed check.
- **Money going out has no hue.** It is the ink. Most rows in a ledger are
  outflow, and forty red numbers is noise, not information.
- **`--flag` (amber) means look at this. `--danger` means destroy or refuse.**
- **A category's colour is a name.** Ten hues, stored as keys, the same in both
  themes under a white glyph, because a bucket's colour does not change with the
  lights. The four split classes borrow four of them; the denominator of every
  meter and ring is the soft surface.

### Form

- **Cards, not slabs.** A card is white on the ground and raised by nothing but
  luminance. No hairline, no lit edge, no shadow — the two layers that genuinely
  float, the sheet and the toast, are the only shadows in the app.
- **Every button is a pill.** Primary 48 px, secondary 40 px, small 32 px; a
  card-coloured pill sits on the ground, a soft one inside a card. The old rule
  that reserved the pill for the primary action is gone; rank is fill, not shape.
- **Circles carry identity.** A bucket, an account, a holding — 40 px in a list
  row, 34 in Settings, 28 inside a chip, 52 on a preview — its colour behind a
  white glyph or a short code.
- **Recession is the ground.** Inside a card, the recessed slab — the goal's
  why — is the ground's own colour; a track or a chip is the soft surface.
- **Press is luminance.** A pill or a row darkens one step under the thumb.
  Nothing scales.
- **App shell.** The window never scrolls. Each screen is a fixed frame with its
  own internal scrolling, which is what guarantees the keypad can never be
  pushed below the fold.

### Type

- **One family: Inter**, self-hosted as a variable face (latin + latin-ext,
  400–600), because a font CDN would break the offline promise. IBM Plex Mono
  left with this edition; money is Inter 600 with tabular figures, and the
  whole app is set `tabular-nums` so a column of amounts still lines up.
- The ladder is 400 / 500 / 600. 500 lives in two places: the keypad's digits
  and the currency beside the amount.
- Sizes are fixed, not fluid: 11 for tab labels, 13 for card labels and subs,
  15 for body and rows, 22 for a card figure, 28 for a screen title, 34 for a
  big figure, 44 for the home hero, 56 for the amount being typed.
- **Card labels are sentence case.** Nothing in the app is uppercase any more.

### Motion

Press by luminance. The toast fades and rises in 220 ms and stays 2.6 s — six
with an undo on it. The toggle's knob moves in 150 ms. The account rail and the
category rail are native horizontal scroll; the account rail snaps one card at
a time. `prefers-reduced-motion` turns all of it off.

### Quality floor, unannounced

Thumb-reachable primary actions and a **44 px minimum touch target** — primary
pills 48, keys 56, tab cells at least 44. Visible keyboard focus, works at 320 px
width, the keypad fully operable from a hardware keyboard, and small text never
sits on the bare ground — it belongs in a card.

---

## 10. Sync protocol — built

Batched, idempotent, cursor-based. Six endpoints.

```
POST /api/v1/pair                 { code }            → { deviceId, token }
POST /api/v1/sync/push            { changes: Row[] }  → { applied, rejected, serverCursor }
GET  /api/v1/sync/pull?since=<cursor>&limit=500       → { changes: Row[], cursor, hasMore }
GET  /api/v1/health                                   → { ok, version }
POST /api/v1/import/gpc           multipart           → { parsed, duplicates }   (P4)
GET  /api/v1/export/xlsx?from&to                      → binary                   (P5)
```

1. **Idempotent on `id`.** Re-pushing the same row is a no-op or an LWW update.
2. **Cursor is a server-assigned monotonic sequence** (`bigserial`), never a
   wall-clock timestamp.
3. **Conflict resolution: last-write-wins on `updatedAt`, tiebreak on `deviceId`
   string compare.** Already implemented client-side in `repo.ts` → `mergeRows`,
   used today by backup import.
4. **Push before pull**, always, in one cycle.
5. Outbox drains oldest-first. On 4xx: mark `lastError`, surface in the UI. On
   5xx / network: exponential backoff, cap 5 min.
6. **Sync never blocks the UI.**
7. Triggers: app foreground, connectivity regained, after write (debounced 10 s),
   manual pull-to-refresh.

The `outbox` table and the `enqueue()` seam in `db/repo.ts` are called by every
mutation, and the seam is gated on whether this device has ever been paired — an
unpaired device queues nothing.

**One deviation from §6, recorded here and in `DECISIONS.md`:** the server does
not mirror the domain model as ten typed tables. It stores each row as JSON in a
single `changes` table, because §10.2 requires a monotonic cursor **across every
entity** and ten tables cannot produce one without a log table beside them. That
log is the storage. The server never computes a balance, validates a category or
touches money — it merges rows and hands them back in order.

**A device joining a ledger that already exists gives up its own seed.** Every
device seeds itself on first launch, so pairing two produces two accounts and two
of every bucket, each device showing an empty tape while holding the other's
rows. `adoptRemoteLedger` soft-deletes a seed account this device never wrote
into, and it runs after every pull rather than only at pairing — because pairing
two devices in quick succession is a race the protocol cannot order.

---

## 11. Phases

| Phase                         | State                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** Foundation             | ✅ TS strict, ESLint, Prettier, Vitest. `money.ts` written and tested first. Dexie schema behind a migration array. Design tokens                                     |
| **P1** MVP, local only        | ✅ Six screens, the checks layer, category set seeded from the real workbook, service worker, installable, works fully in airplane mode. No backend, no sync, no auth |
| **P2** Sync                   | ✅ Protocol, engine, pairing and the deployment — `deploy/` and `DEPLOYMENT.md`. Never run against real Postgres; there is no Docker on the development machine       |
| **P3** Reliability & guidance | Designed, not built                                                                                                                                                   |
| **P4** Import                 | Not started                                                                                                                                                           |
| **P5** Reporting              | Not started                                                                                                                                                           |

Targeting (§2.2), investments (`INVESTMENTS.md`), recurring payments
(`RECURRING.md`), sync and reporting shipped on top of P1, ahead of their
phases, each for a reason recorded in `DECISIONS.md`.

### The gate

P1 is **done when** the app has been installed on the phone and used for
**14 consecutive days** without touching the code. ← _this is where the project
is now._

> Stop here. Ship no new feature until those 14 days are done. Real usage will
> invalidate a meaningful share of the P3 assumptions in this document, and it is
> cheaper to learn that before the sync layer exists.

Defects and repository housekeeping are exempt — see `TODO.md` §1 and §2.

The scope of each unstarted phase, and everything left inside the shipped ones,
is in `TODO.md` §4.

---

## 12. Repository layout

```
Prosper/
├─ apps/
│  ├─ web/                          # SvelteKit PWA
│  │  ├─ CLAUDE.md                  #   app-specific working rules
│  │  ├─ src/lib/domain/            # PURE — no Dexie, no fetch, no DOM
│  │  │  ├─ money.ts                #   the only place money is computed
│  │  │  ├─ amount-input.ts         #   keypad state machine
│  │  │  ├─ datetime.ts  czech.ts   #   Czech dates and plurals via Intl
│  │  │  ├─ ids.ts                  #   UUIDv7
│  │  │  ├─ types.ts                #   the data model
│  │  │  ├─ ledger.ts               #   tape building, rankings
│  │  │  ├─ receivables.ts          #   money owed to you
│  │  │  ├─ goals.ts                #   Targeting: targets, pace, the record
│  │  │  ├─ prosperity.ts           #   the 10/10/10/70 split, against income
│  │  │  ├─ holdings.ts             #   stated values, staleness, the total
│  │  │  ├─ recurring.ts            #   declared schedules, catch-up, cost
│  │  │  ├─ trends.ts               #   month over month, per bucket
│  │  │  ├─ xlsx.ts                 #   a spreadsheet, without a dependency
│  │  │  ├─ vocabulary.ts           #   Petr's own words, from the workbook
│  │  │  └─ checks.ts               #   the four laws, enforced
│  │  ├─ src/lib/db/                # schema + migrations; the only writer
│  │  ├─ src/lib/sync/              # outbox drain, pull, pairing, status
│  │  ├─ src/lib/ui/                # hand-rolled components, no UI kit
│  │  ├─ src/lib/styles/            # tokens.css, app.css, self-hosted fonts
│  │  ├─ src/routes/                # / · /tape · /mesic · /platby · /cil
│  │  │                             #   · /jmeni · /nastaveni
│  │  ├─ src/service-worker.ts      # app shell cache, hand-rolled
│  │  └─ vite.config.ts             # SvelteKit + adapter + Vitest, all inline
│  └─ api/                          # ASP.NET Core 10 + EF Core + Postgres 16
│     ├─ src/Prosper.Api/           #   pairing, push, pull, health
│     └─ tests/Prosper.Api.Tests/   #   50 tests, SQLite in memory
├─ deploy/                          # compose, both nginx configs, backup.sh
├─ packages/contracts/              # the sync protocol, shared with the client
├─ scripts/check-bundle.mjs         # the 150 kB budget, enforced
├─ .github/workflows/ci.yml         # lint · check · test · build · budget · api
├─ docs/
│  ├─ PROJECT-PLAN.md               # this file — the app as it stands
│  ├─ TODO.md                       # the only backlog
│  ├─ DECISIONS.md                  # ADR log — every answer, every deviation
│  ├─ TRIMMING-AND-TRAINING.md      # laws 3 and 4 — design, not yet built
│  ├─ INVESTMENTS.md                # /jmeni — shipped, plus what is left
│  ├─ RECURRING.md                  # declared recurring payments — shipped
│  ├─ DEPLOYMENT.md                 # the VPS runbook — Docker, nginx, backups
│  └─ screens/                      # README screenshots
├─ CLAUDE.md                        # working rules for the whole repository
├─ LICENSE                          # MIT
└─ pnpm-workspace.yaml
```

There is **no `svelte.config.js`** — the SvelteKit plugin, the adapter and
Vitest are all configured inline in `apps/web/vite.config.ts`.

---

## 13. Rules for the implementer

Non-negotiable. Violations are bugs regardless of test status.

1. **No floating point for money.** Ever. Integer minor units only. All
   arithmetic through `domain/money.ts`.
2. **Soft delete only.** No `DELETE` on user data, client or server.
3. **Client generates all ids.** UUIDv7.
4. **Every mutation goes through `db/repo.ts`**, which stamps `updatedAt` /
   `deviceId` and calls the outbox seam. No component writes to Dexie directly.
5. **Never block the UI on network.** Offline is the normal case, not the error
   case.
6. **`src/lib/domain/` is pure.** No Dexie, no fetch, no DOM. It is the part that
   gets unit tested, and it is where any new rule belongs.
7. **No check may block a save.** Checks advise, offer a one-tap fix, and get out
   of the way.
8. **No component library.** Hand-rolled components against the token set.
9. **Colours only from `tokens.css`.** No literal hex in a component.
10. **No `localStorage` for domain data.** IndexedDB only. `localStorage` holds
    the theme preference and nothing else.
11. **Czech date and money formatting via `Intl`**, never hand-rolled. Czech
    plurals via `domain/czech.ts` — "3 záznamy", not "3 záznamů".
12. **Ask before adding a dependency.** Every package is a bundle-size decision
    against the 150 kB budget. The app ships one: Dexie.
13. **A schema change is a new entry in the `migrations` array**, never an edit
    to an existing one — a released version is already on the phone.
14. **Update `DECISIONS.md`** whenever a question gets answered or an assumption
    turns out wrong.

### Testing

**333 unit tests, Vitest, eighteen files.** Most are against `domain/`, which is
the whole point of the layer being pure. Three files are the exceptions, and each
earns it: `db/repo.test.ts` and `db/schema.test.ts` test persistence and
migrations, which _are_ the thing being tested, and `sync/engine.test.ts` drives
the outbox against a stubbed server.

The API has **50 tests of its own** (`dotnet test`). The ones that reach the
database use SQLite in memory rather than the EF in-memory provider — that code
opens transactions and relies on a unique index, and the in-memory provider
honours neither. The rest are pure: the rate limiter's partition key, which is
the one place a header decides something.

- `money.ts` exhaustively, including the magnitudes where a float would round
  wrong. Tape building and gap days. Keypad state. Every check rule.
  Receivables. Goal validation, pace and history. Czech plurals. Merge/LWW
  logic. Current valuation, staleness and the wealth total. Recurring due dates,
  month clamping, bounded catch-up and the annual figure.
- **The one test that must never be deleted** is in `holdings.test.ts`:
  `summariseMonth` and `prosperitySplit` asserted byte-identical with a full set
  of holdings in the database. It fails if anyone ever wires unrealised growth
  into income, which would make the 10/10/10/70 split fiction.
- **Integration:** the outbox drain against a mock API — happy path, 4xx, 5xx,
  offline mid-flush, duplicate push. All present in `sync/engine.test.ts`.
- **Migrations are tested against a database built at the old version.** A
  migration that has only ever run against an empty database has not been tested
  at all, and a released version is already on the phone.
- **The bundle budget is a test.** `pnpm budget` fails the build over 150 kB
  brotli on the entry route. A budget nobody measures is a preference.
- **Manual, mandatory before each phase ships:** airplane mode → enter 5
  transactions → force-close the app → reopen → reconnect → verify all 5 on the
  server, outbox at zero.
- Skip E2E browser tests. Single user, disproportionate maintenance cost.

---

## 14. Risks

| Risk                                                        | Likelihood        | Mitigation                                                                                                              |
| ----------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Abandoned like the Excel sheet                              | **High**          | The 14-day P1 gate exists precisely for this. If it fails, the design is wrong — fix it or stop.                        |
| Mandatory category adds enough friction to hurt entry speed | Medium            | New as of 2026-08-23. Watch it during the 14 days; the fallback is a default bucket, not a queue.                       |
| Entry too slow, defeats the purpose                         | Medium            | Measure it. Actual stopwatch, from home screen tap. Not a vibe. Still outstanding — `TODO.md` §3.                       |
| The checks become nagging and get ignored                   | Medium            | Nothing blocks; warnings are one line with a one-tap fix. If a rule fires constantly, the rule is wrong — fix the rule. |
| Only copy of the ledger is one browser profile              | **High until P2** | Settings nags about JSON export. `navigator.storage.persist()` requested on every load.                                 |
| A backup written by a newer build, imported by an older one | Low               | Currently unguarded — `TODO.md` §1.4.                                                                                   |
| iOS PWA limitations bite                                    | Low               | Android is primary.                                                                                                     |
| Sync merge corrupts the ledger                              | Low               | Soft delete + append-mostly + idempotency. Nightly `pg_dump` to NAS.                                                    |
| Scope creep into a full accounting system                   | Medium            | The non-goals list in §3 is binding.                                                                                    |

---

## 15. Handoff prompt for the next phase

> Read `docs/PROJECT-PLAN.md`, `docs/DECISIONS.md` and `docs/TODO.md` in full
> before writing any code.
>
> P0 and P1 are shipped and in use. **Do not start P2 until the 14-day gate in
> §11 has passed**, and when it has, expect some of the P3 assumptions in
> `TRIMMING-AND-TRAINING.md` to be wrong — ask before building on them. The
> defects in `TODO.md` §1 and the housekeeping in §2 are exempt from the gate
> and can be done now.
>
> P2 is built and verified two-device against a real server. What is left of it
> is deployment rather than code: a run against actual Postgres, the nightly
> `pg_dump`, and serving the client from the same origin.
>
> The next feature phase is **P3** — reconciliation, the coverage ring, category
> caps, the monthly close ritual and the nudge. Most of it is blocked on Q29–Q32
> in `TODO.md` §5; ask before building on them.
>
> Follow §13 without exception. The domain layer stays pure and stays tested.
