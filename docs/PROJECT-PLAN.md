# Výdaje — Project Plan

**Name:** Výdaje
**Owner:** Petr
**Status:** P0 and P1 shipped — in daily use, 14-day gate running. Targeting
(§2.2) shipped 2026-08-24. P2 (sync) not started.
**Audience:** Claude Code (implementation), Petr (decisions)
**Last revised:** 2026-08-24

> This document describes the app **as it now stands**, not as it was first
> imagined. Where reality and the original plan disagreed, reality won and the
> reasoning is recorded here or in `DECISIONS.md`. Both are binding on future
> work.

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
rather than a page of advice. A feature that serves no law is a feature this
project does not build.

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
| Days with no record render as **visible holes** in the tape, not as absence.                                                                                                                   | `domain/ledger.ts` → `buildTape`    |
| An explicit "spent nothing today" mark, so a real zero is distinguishable from a forgotten day.                                                                                                | `DayMark`                           |
| The previous day closes itself — but **only if the app was open on it** and nothing went in. Having it in your hand and recording nothing is evidence; a day you never opened it stays a hole. | `db/repo.ts` → `closePreviousDay`   |
| The monthly check reports coverage — "Zapsáno 12 z 23 dní" — and says plainly that the totals are therefore too low.                                                                           | `checks.ts` → `coverage`            |

**The original spreadsheet had no dates at all** — only which month sheet a row
sat on. Tracking was, strictly speaking, impossible. That single observation
justifies most of this section.

### 2.2 Targeting — _unwritten goals are wishes_

| Mechanism                                                                                                                                                                                                                                                                    | Where                                                              | Status  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| A `Goal` cannot be saved without **all three** of: a why (min 10 chars), an amount, and a date. The refusal is the mechanism, not a validation nicety — the save button names the missing piece rather than accepting the tap and complaining.                               | `domain/goals.ts` → `validateGoal`, `/cil`                         | shipped |
| **The month is the horizon anybody acts on.** A `MonthTarget` is one month's written commitment. The app can always _compute_ what the month has to carry; that number becomes a target only once he says yes to it, and the screen shows which of the two it is looking at. | `domain/types.ts` → `MonthTarget`, `db/repo.ts` → `setMonthTarget` | shipped |
| The goal is on the launch route, permanently: name, this month's bar, what is still missing.                                                                                                                                                                                 | `ui/GoalStrip.svelte`                                              | shipped |
| Progress is read off the ledger that already exists — money that landed in the goal's bucket, nothing else. No second set of books, which is the only reason it can be trusted.                                                                                              | `domain/goals.ts` → `contributions`                                | shipped |
| Saving into the goal's bucket makes the confirmation say where the month now stands. The cheapest place to put a target in front of somebody is the half-second after they moved towards it.                                                                                 | `/` → `goalLine`                                                   | shipped |
| `SPOŘENÍ` is its own bucket, and is what a new goal points at by default. In the spreadsheet, "dlouhodobá investice" — 2 000 Kč every month without fail — was buried inside OSTATNÍ, so the one number this law needs could not be read.                                    | `db/seed.ts`, `domain/goals.ts` → `defaultGoalCategory`            | shipped |
| Required monthly contribution, computed exactly and **rounded up** — a number that lands a few haléře short every month misses the date.                                                                                                                                     | `domain/goals.ts` → `requiredMonthly`                              | shipped |
| The record of months, ✓ or ✗ against the number he committed to. This is where Targeting turns into Training.                                                                                                                                                                | `domain/goals.ts` → `monthHistory`                                 | shipped |
| The month's net is the first thing on screen, every launch.                                                                                                                                                                                                                  | `ui/MonthTotals.svelte`                                            | shipped |

### 2.3 Trimming — _"necessary" expenses expand to match income_

Trimming is impossible when spending hides in the wrong bucket, so most of this
law is enforced at entry time rather than at review time.

| Mechanism                                                                                                                                                                                                                     | Where                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Every category carries a `spendType`: `need` / `want` / `give` / `save` / `debt`. This is what both splits read; it is not cosmetic.                                                                                          | `domain/types.ts`                    |
| Groceries (`POTRAVINY`, need) are separated from eating out (`JÍDLO`, want) — the discretionary half is the half you can act on.                                                                                              | `db/seed.ts`                         |
| A description that looks like another bucket raises a one-tap correction **before** the row is saved.                                                                                                                         | `checks.ts` → `misfiled`             |
| `OSTATNÍ` is watched: once it passes 15 % of the month's recurring outflow, the app says so and asks what belongs elsewhere.                                                                                                  | `checks.ts` → `other-overflow`       |
| One-off spending is separated from the running cost of a month, so a single purchase cannot flatter or ruin the average.                                                                                                      | `Txn.isOneOff`, `/mesic`             |
| A vague description on a large amount is challenged while it can still be fixed.                                                                                                                                              | `checks.ts` → `vague`                |
| The **10 / 10 / 10 / 70 split**, measured against income rather than outflow — a share of outflow always sums to 100 % and can never say whether more went out than came in. Two rings: what you did, and what the book says. | `domain/prosperity.ts`, `/mesic`     |
| `give` is a spend type of its own. Money given away with nothing expected back is not a want, and filed as one it vanishes into the discretionary pile.                                                                       | `domain/types.ts` — DECISIONS.md Q33 |

**Evidence this law needed teeth:** 25 286 Kč of food was filed under BYDLENÍ,
LIFESTYLE, DARY and PROJEKTY across eight months while JÍDLO reported 13 083 Kč.
The most controllable category in the book was under-reported threefold.

**What is still missing:** the law now has enforcement and a target _shape_, but
no _cap_. `Category.monthlyCap` is in the schema and null on every row. The
design — one cap a month, chosen from evidence, visible on the entry chip — is in
`TRIMMING-AND-TRAINING.md`.

### 2.4 Training — _repetition until it is a habit_

| Mechanism                                                                                                                               | Where                             | Status                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------- |
| The checks run on **every keystroke** of every entry. Training is not a monthly event; it is a hundred small corrections.               | `checks.ts` → `checkDraft`        | shipped                                                       |
| Nothing a check says ever blocks a save. A system that punishes recording is a system that stops being used.                            | `checks.ts` (contract)            | shipped                                                       |
| A subscription seen in each of the last three months but missing from this one becomes a question.                                      | `checks.ts` → `missing-recurring` | shipped                                                       |
| The record of months against a written target — ✓ or ✗, four in a row being the book's actual claim about training.                     | `/cil` → `monthHistory`           | shipped                                                       |
| Monthly close ritual: empty the queue, reconcile, review the split, set one cap, write one sentence.                                    | —                                 | **P3** — designed in `TRIMMING-AND-TRAINING.md`               |
| Coverage ring and streak.                                                                                                               | —                                 | **P3** — designed                                             |
| ~~Health score~~ — a single compounded number is uninterpretable when it moves, which is the one thing a training signal must never be. | —                                 | **proposed for rejection**, see `TRIMMING-AND-TRAINING.md` R4 |

---

## 3. Success criteria

| Metric                                                    | Target               | Actual                                                                      |
| --------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| Time from home screen tap to saved transaction            | ≤ 5 s                | 3 actions: type, tap bucket, save — **needs a real stopwatch on the phone** |
| Cold start to interactive (mid-range Android, cache warm) | ≤ 1 s                | not yet measured on device                                                  |
| JS bundle, brotli, initial route                          | ≤ 150 kB             | **74.7 kB**                                                                 |
| CSS, brotli                                               | —                    | 5.1 kB                                                                      |
| Self-hosted fonts                                         | —                    | 108 kB, cached once, offline-safe                                           |
| Days-covered                                              | ≥ 90 % after month 2 | pending                                                                     |
| Reconciliation delta vs bank, month end                   | 0 Kč                 | pending (P3)                                                                |
| Still in daily use                                        | month 3              | **the real metric**                                                         |

Excel failed on friction, not features. Every design decision defers to entry
speed.

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

|                | Decision                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| Frontend       | **SvelteKit 2.63 + Svelte 5.56** (runes forced), Vite 8, TypeScript 6 strict    |
| Client storage | **Dexie 4.4.5**, schema v1 behind a migration array                             |
| Money          | `number` in minor units (haléře), branded `Minor`, all arithmetic in one module |
| Ids            | Client-generated **UUIDv7**, hand-rolled, no dependency                         |
| Hosting        | Static output (`adapter-static`), same origin as the API from P2                |
| UI language    | **Czech.** Code, identifiers, comments and docs stay English                    |
| Currency       | CZK only; `currency` column present and unused on every account                 |
| Phone          | Android primary; iOS kept working as a degraded case                            |
| History import | **None.** Clean start — the 2026 workbook has no dates to import                |
| Backend / sync | ASP.NET Core 9 + Postgres 16, hand-rolled outbox + LWW — **P2, not written**    |

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
│  │  5 screens  │   │  PURE, no IO │   │ txns, categories, │  │
│  └─────────────┘   │  148 tests   │   │ accounts, OUTBOX  │  │
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
┌──────────────── CONTABO VPS (Docker) — P2 ───────────────────┐
│  Caddy  →  ASP.NET Core 9 Minimal API  →  Postgres 16        │
│                                        nightly pg_dump → NAS │
└──────────────────────────────────────────────────────────────┘
```

**Client is the source of truth for authoring. Server is durable storage and a
cross-device merge point.** The app must be fully functional with the server
permanently down — which, today, it is, because there is no server.

---

## 6. Data model

Client and server mirror each other. Client TS shown; server mirrors in C# with
`long` for money.

```ts
// All ids are client-generated UUIDv7 (time-sortable). Server never assigns ids.
// All money is integer minor units (haléře). Signed: negative = outflow.

type Minor = number & { __brand: "minor" };

type AccountKind = "checking" | "savings" | "cash" | "credit" | "loan";
type SpendType = "need" | "want" | "save" | "debt";
type TxnSource = "manual" | "import-gpc" | "bank-api" | "recurring";

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
  currency: string; // 'CZK'
  isArchived: boolean;
  sortOrder: number;
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
  owedAmount: Minor | null; // DEVIATION — DECISIONS.md Q25
  owedBy: string | null;
  settledByTxnId: string | null;
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
}

interface MonthTarget extends Synced {
  // one month's written commitment
  id: string;
  goalId: string;
  month: string; // YYYY-MM
  amount: Minor; // positive magnitude
}

interface DayMark {
  // explicit "I spent nothing today"
  date: string; // PK
  deviceId: string;
  updatedAt: string;
}

interface OutboxEntry {
  // client-only, never synced. Idle until P2.
  seq?: number;
  entity:
    | "txn"
    | "account"
    | "category"
    | "goal"
    | "monthTarget"
    | "reconciliation"
    | "dayMark";
  entityId: string;
  payload: unknown; // full row, not a diff
  queuedAt: string;
  attempts: number;
  lastError: string | null;
}
```

### 6.1 Invariants

- **Soft delete only.** `isDeleted` is never un-set by a sync merge. (A local
  undo immediately after a delete is a different thing and is allowed.)
- **A transaction must have a category.** The UI offers no way to save without
  one; `categoryId` stays nullable only so pre-existing and future imported rows
  can be represented and then fixed. See §6.2.
- **Transfers are two rows**, mirrored amounts, mutually referencing
  `transferPairId`. Never one row. Never a magic "transfer" category.
- **Every transaction belongs to an account.** No orphans.
- **An outstanding share is not money.** `owedAmount` never touches the balance
  or any total until it is settled and `settledByTxnId` points at the inflow
  that carried it.
- **An inflow filed under a spending bucket is a refund**, and nets against that
  bucket rather than counting as income.
- **Goal progress is read off the ledger, never stored.** A contribution is an
  ordinary outflow into the goal's bucket. There is no second set of books, and
  that is the only reason the progress figure can be trusted.
- **A computed monthly figure is not a target.** `MonthTarget` exists so the
  number he agreed to is distinguishable from the number the app worked out. The
  screen says which one it is showing.
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

`domain/checks.ts` — pure, 148 tests across the domain layer. Every rule exists
because the spreadsheet already went wrong that way, and each carries the figure
from the workbook in a comment so nobody later deletes it as theoretical.

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
| `coverage`          | Days with no record, stated as "the totals are lower than reality"                                |
| `overspend`         | The month spent more than it earned                                                               |
| `missing-recurring` | A subscription present in the last three months and absent from this one                          |

Four of the workbook's eight months ran a deficit — LEDEN −23 355, BŘEZEN −238,
KVĚTEN −45 937, ČERVENEC −10 048 — and no screen he looked at ever said so.

---

## 8. Screens

Five, all shipped.

### `/` — Entry (the launch route)

```
┌────────────────────────────────────┐
│ SRPEN 2026            [tape] [gear]│  ← month totals, tap = /mesic
│ Celkem                             │
│ −27 861,00 Kč      ↑59 414 ↓87 275 │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Rezerva  ▓▓▓▓░░░  2 800/4 285      │  ← the goal, always, tap = /cil
├────────────────────────────────────┤
│          [ Výdaj | Příjem ]        │  ← segmented, half-height
│                                    │
│            −249,00  Kč             │  ← the object, in a pool of light
│                                    │
│ [POTRAVINY][JÍDLO][BYDLENÍ][search]│  ← 3 most-used + search sheet
│ ⚠ Spíš JÍDLO?          DÁT DO JÍDLO│  ← live check, one-tap fix
│ [dnes] [komu / za co............]  │
│ [mimořádný výdaj]      [dluží mi]  │
│ ┌────────────────────────────────┐ │
│ │  1    2    3                   │ │  ← floating slab
│ │  4    5    6                   │ │
│ │  7    8    9                   │ │
│ │  ,    0    ⌫                   │ │
│ │  [        ULOŽIT        ]      │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

The month's standing is the first thing visible, every launch — the answer to
"how am I doing" before anything is typed.

### `/tape` — Ledger

Reverse-chronological, one floating card per month, days separated by dashed
perforations, running balance per row, gap days rendered as hatched holes, open
receivables marked in amber. Tap a row to edit or delete.

### `/mesic` — Month

The workbook's `SUMA` sheet, rebuilt: income / outflow / net, one-off spending
separated from the running cost, the **Kontrola** panel listing the month's
findings, buckets ranked by spend with spend-type colouring, and **Dluží mi** —
everything outstanding, with a one-tap _Přijato_ that creates the repayment.

Plus **Rozdělení příjmu**: the 10 / 10 / 10 / 70 split as two rings, what you did
above what the book says, sharing one set of colours so the comparison is made by
eye. The centre of the first ring carries the remainder — what is left of the
month's income, or how far past it you went. Each class shows its distance from
its mark, and one line names the single class furthest below.

### `/cil` — Goal

The Targeting law, in three parts and that order: **the why** in his own words at
the top, before any number; **this month's** figure, marked as committed or
merely proposed, with a one-tap _Odložit_ that writes the ordinary outflow; and
**the record of months**, ✓ or ✗ against what he actually agreed to.

The form is the refusal: the save button reads _"Napiš proč"_ until the why
clears ten characters, _"Zadej termín"_ until the date is in the future. This is
the one place in the app where something blocks a save — a half-written goal
records nothing, unlike a half-described expense, which at least holds the
amount.

### `/settings`

Account name and opening balance, category management (rename, spend type,
archive, add), theme, JSON export/import backup, storage-persistence status,
schema version.

Not yet built: **Monthly close** (P3), **Reconcile** (P3), and the Trimming and
Training mechanisms designed in `TRIMMING-AND-TRAINING.md`.

---

## 9. Design

Grounded in the subject: a **receipt tape**, floating in light. Not a dashboard,
not a fintech gradient.

### Palette — quiet blue, both themes

The original cool-grey paper palette was replaced on 2026-08-23. Tokens live in
`lib/styles/tokens.css` and are the only place colours are defined.

```css
/* light */                    /* dark */
--paper:  #ECEFF7;             #0A1120   /* the ground */
--tape:   #FFFFFF;             #141D30   /* a floating surface */
--ink:    #101A2B;             #E7EDF9
--rule:   #DAE1EE;             #233149
--accent: #2F6BD8;             #6E9CF5   /* primary action, selection */
--out:    #B8403C;             #F0857E   /* outflow — muted brick */
--in:     #1B7A5F;             #55C6A2   /* inflow — teal-green */
--flag:   #8F5F05;             #EEBB55   /* amber: needs attention */
```

Dark mode is required — this app is used one-handed, in bed, with the lights
off. Both palettes are declared twice — once for the system preference, once for
an explicit `data-theme` — so the toggle wins in both directions.

**Contrast, verified in both themes:** every ink/surface pair used for body text
meets **WCAG AA (4.5:1)** on `--tape`, `--tape-2`, `--paper` and on all three
washes. The light amber and the tertiary ink were both darkened on 2026-08-23 to
reach it.

The one exception is deliberate: `--paper-2`, the far end of the background
gradient, sits between 4.2:1 and 4.4:1 for the semantic colours. Nothing small is
ever painted there — the only text over the bare ground is the entry amount at
55 px, where the large-text threshold is 3:1. **Rule: no small text directly on
the ground.** Text belongs on a slab.

### Form

- **Slabs, not sheets.** Every surface has a hairline, a soft shadow and an 18 px
  radius, and sits above a gradient ground.
- **The amount sits in light.** A radial glow behind it, nothing else near it —
  the one "object" on the screen. Pure CSS; there is no 3D asset to download.
- **App shell.** The window never scrolls. Each screen is a fixed frame with its
  own internal scrolling, which is what guarantees the keypad can never be
  pushed below the fold.

### Type — the signature

- UI / body: **Instrument Sans**
- **All money is monospace, always** — IBM Plex Mono, `tabular-nums`,
  right-aligned. Columns of amounts align to the decimal. This is functional and
  it is the visual identity.
- The largest type on any screen is a mono amount. No decorative display face.
- Both faces are **self-hosted** (108 kB, latin + latin-ext). A font CDN would
  break the offline promise.

### Money toasts

Saving money is not the same event as saving a setting, and does not look like
one: the amount at 28 px in the direction's colour, an arrow badge, bucket and
payee underneath, undo, and a spring-in landing.

### Quality floor, unannounced

Thumb-reachable primary actions, **44 px minimum touch targets** (the segmented
direction control is visually half that and recovers the target with an
invisible inset), visible keyboard focus, `prefers-reduced-motion` respected,
works at 320 px width, keypad fully operable from a hardware keyboard.

---

## 10. Sync protocol — P2, not yet built

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

The `outbox` table and the `enqueue()` seam in `db/repo.ts` already exist and are
called by every mutation. `SYNC_ENABLED` is `false`; flipping it on is where P2
starts.

---

## 11. Phases

### P0 — Foundation ✅ _shipped_

Repo, TS strict, ESLint, Prettier, Vitest. `money.ts` written and tested first.
Dexie schema v1 with a migration array. Design tokens.

**Done:** `money.test.ts` passes including negative amounts, rounding, and Czech
formatting (`1 234,50 Kč`).

### P1 — MVP, local only ✅ _shipped_

Entry screen, ledger tape, month view, settings. Category set seeded from the
real workbook. One account. Service worker, installable, works fully in airplane
mode. The checks layer. **No backend, no sync, no auth.**

**Done when:** installed on the phone and used for **14 consecutive days**
without touching the code. ← _this is where the project is now_

> Stop here. Ship nothing further until those 14 days are done. Real usage will
> invalidate a meaningful share of the P3 assumptions in this document, and it is
> cheaper to learn that before the sync layer exists.

### P2 — Sync

ASP.NET Core API, Postgres, Docker Compose on Contabo. Device pairing, JWT.
Outbox drain, push/pull, LWW merge. Sync status in Settings.

**Done when:** a transaction entered offline on the phone appears in the desktop
browser after reconnect, and vice versa, with the outbox draining to zero.

### P3 — Reliability & guidance

Reconciliation flow. Days-covered ring and streak. Category caps.
**Monthly close ritual.** Nudge notification. Full design, with build order and
the four questions it needs answered first, in `TRIMMING-AND-TRAINING.md`.

_(The Goals screen moved out of this phase — it shipped 2026-08-24, ahead of the
gate, because Targeting was the one law with no mechanism at all.)_

**Done when:** the first month closes with a zero reconciliation delta.

### P4 — Import

GPC/ABO parser. Duplicate detection: date ± 3 days + exact amount + fuzzy payee.
Review-before-apply screen. **Never auto-apply an import.**

### P5 — Reporting

Category trends month over month. XLSX export via ClosedXML. Goal progress.

---

## 12. Repository layout

```
financni prosperita/
├─ apps/
│  ├─ web/                          # SvelteKit PWA
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
│  │  │  ├─ vocabulary.ts           #   Petr's own words, from the workbook
│  │  │  └─ checks.ts               #   the four laws, enforced
│  │  ├─ src/lib/db/                # schema + migrations; the only writer
│  │  ├─ src/lib/ui/                # hand-rolled components, no UI kit
│  │  ├─ src/lib/styles/            # tokens.css, app.css, self-hosted fonts
│  │  ├─ src/routes/                # / · /tape · /mesic · /cil · /settings
│  │  └─ src/service-worker.ts      # app shell cache, hand-rolled
│  └─ api/                          # ASP.NET Core 9 — P2, not started
├─ packages/contracts/              # shared TS sync types — P2
├─ docs/
│  ├─ PROJECT-PLAN.md               # this file
│  ├─ TRIMMING-AND-TRAINING.md      # laws 3 and 4 — design, not yet built
│  └─ DECISIONS.md                  # ADR log — every answer, every deviation
└─ pnpm-workspace.yaml
```

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
    against the 150 kB budget.
13. **A schema change is a new entry in the `migrations` array**, never an edit
    to an existing one — a released version is already on the phone.
14. **Update `DECISIONS.md`** whenever a question gets answered or an assumption
    turns out wrong.

### Testing

- **Unit (Vitest):** `money.ts` exhaustively. Tape building. Keypad state.
  Every check rule. Receivables. Goal validation, pace and history. Czech
  plurals. Merge/LWW logic. Current valuation, staleness and the wealth total —
  including the invariant that holdings never reach the month summary or the
  split. Recurring due dates, month clamping, bounded catch-up and the annual
  figure. — _203 tests_
- **Integration (P2):** outbox drain against a mock API — happy path, 4xx, 5xx,
  offline mid-flush, duplicate push.
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
| Entry too slow, defeats the purpose                         | Medium            | Measure it. Actual stopwatch, from home screen tap. Not a vibe.                                                         |
| The checks become nagging and get ignored                   | Medium            | Nothing blocks; warnings are one line with a one-tap fix. If a rule fires constantly, the rule is wrong — fix the rule. |
| Only copy of the ledger is one browser profile              | **High until P2** | Settings nags about JSON export. `navigator.storage.persist()` requested on every load.                                 |
| iOS PWA limitations bite                                    | Low               | Android is primary.                                                                                                     |
| Sync merge corrupts the ledger                              | Low               | Soft delete + append-mostly + idempotency. Nightly `pg_dump` to NAS.                                                    |
| Scope creep into a full accounting system                   | Medium            | The non-goals list in §3 is binding.                                                                                    |

---

## 15. Handoff prompt for the next phase

> Read `docs/PROJECT-PLAN.md` and `docs/DECISIONS.md` in full before writing any
> code.
>
> P0 and P1 are shipped and in use. **Do not start P2 until the 14-day gate in
> §11 has passed**, and when it has, expect some of §11's P3 assumptions to be
> wrong — ask before building on them.
>
> Implement **P2 only**: the ASP.NET Core 9 API, Postgres schema mirroring §6,
> device pairing, and the outbox drain. The client seam already exists in
> `db/repo.ts` — `enqueue()` and the `SYNC_ENABLED` flag.
>
> Follow §13 without exception. The domain layer stays pure and stays tested.
>
> When P2 is done, list what you found in this document that is wrong,
> underspecified, or that you disagree with, before P3 starts.
