# Investments — what I own, and what it is worth today

**Status:** items 1–4 **built** 2026-08-25. Q36–Q39 ruled — see `DECISIONS.md`.
Items 5–8 (holding management in Settings, the stale finding on `/mesic` and the
entry screen, contributions and growth, the push channel) are still design.
**Audience:** Claude Code (implementation), Petr (decisions)
**Reads with:** `PROJECT-PLAN.md` §3, §4, §6.1, §8 and `DECISIONS.md`

> The rule this document is written under is `PROJECT-PLAN.md` §2: **a feature
> that serves no law does not get built.** This one serves Targeting. A goal
> the size of a six-month reserve is not reached out of a current account, and
> the app currently cannot see the place it is actually being reached in.
>
> It is written under a second rule too, and that one is harder: **a stated
> number and a computed number must never sit in the same column without
> saying which is which.** Everything the app reports today is derived from the
> ledger. An investment's value is not derivable from anything — it is a fact
> from outside, typed in by hand, and stale the moment after. Most of the
> design below is about keeping that difference visible instead of averaging it
> away.

---

## 0. What this reverses

`PROJECT-PLAN.md` §3 lists **"Investment portfolio tracking, net worth"** as a
v1 non-goal. This document proposes reversing that, and the reversal has to be
recorded as **Q36** before anything is built, because §3 is binding.

The case for reversing it:

- The non-goal was written against _portfolio tracking_ — tickers, units, cost
  basis, prices fetched from somewhere. That is still rejected here, in full.
  What is proposed is one number per holding, typed in by hand.
- The Targeting law already runs on a figure the app cannot see. `SPOŘENÍ` and
  `INVESTICE DO MĚ` take money out of the ledger every month and the ledger
  loses sight of it at the moment it leaves. The app can say what was set aside
  and not what it grew into.
- It costs the entry path nothing. Nothing in this document touches `/`, the
  keypad, the checks that run while typing, or the five-second budget — which
  is also why it is the one piece of new work that can be built **before** the
  14-day gate (§11) without contaminating it.

The case against, honestly: it is a fifth screen and a second kind of number,
and both were things §3 spent effort keeping out.

---

## 1. What must not break

| Already true                                                | What this must do about it                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Contributions are ordinary outflows into a `save` bucket    | Leave them exactly as they are. No new entry path          |
| `summariseMonth` decides income, outflow, net, buckets      | Never see a holding. Not one line changes in `checks.ts`   |
| `prosperitySplit` measures shares against **income** (Q34)  | Never see a holding. Growth is not income — see I4         |
| Goal progress is read off the ledger, never stored (§6.1)   | Unchanged. A holding is not a goal and does not fund one   |
| Soft delete only; client ids; every write through `repo.ts` | Same rules, no exceptions                                  |
| `/` is the launch route and is protected hardest            | Gains one icon in a header that already has two. No height |

The single most important line in the table is the third. If a valuation ever
reaches `income`, the 10 / 10 / 10 / 70 split silently becomes fiction — a month
where the pension moved up 8 000 Kč would report a healthy savings share out of
money that was never earned or allocated. **This is the failure mode the whole
design is arranged to make impossible**, and it gets a test of its own.

---

## I1 — The model: a holding, and a series of readings

Two tables.

```ts
export type HoldingKind = "fund" | "pension" | "crypto" | "property" | "other";

export interface Holding extends Synced {
  id: string;
  name: string; // 'Penzijko', 'ETF', 'Byt'
  kind: HoldingKind; // the dot colour, nothing more
  currency: string; // 'CZK', unused — same contract as Account
  /**
   * Which bucket funds it. `null` = don't attribute contributions at all.
   * See I4 for why this is allowed to be null and when it must be.
   */
  categoryId: string | null;
  /** The day it starts counting. Same reason as `Goal.startDate` (Q27). */
  startDate: IsoDate;
  /** How often it is worth asking. Per holding, not global — see I5. */
  reminderDays: number; // default 30
  isArchived: boolean;
  sortOrder: number;
}

export interface Valuation extends Synced {
  id: string;
  holdingId: string;
  date: IsoDate; // the day the value was true, not the day it was typed
  value: Minor; // positive magnitude
  note: string | null;
  createdAt: IsoDateTime; // tie-breaks two readings on one date
}
```

**A series, not a `currentValue` column.** A mutable field would answer "what is
it worth" and lose the two things that make the answer usable: _when was that
true_, which the reminder needs, and _what did it do since_, which is the only
reason to look at the screen twice. It also matches the append-only shape of
everything else in the app — nothing here is ever edited in place, and a wrong
reading is soft-deleted like a wrong transaction.

**Current value** = the live valuation with the greatest `date`, breaking ties on
`createdAt`. One function, `currentValuation()`, and nothing else is allowed to
pick.

### Why not an `Account` with `kind: 'investment'`

Tempting — the table exists, it has `openingBalance`, and `Reconciliation` even
looks like "here is what it is really worth".

It is the wrong shape, and specifically: **an account's balance is derived
(`balanceOf(openingBalance, txns)`), a holding's value is asserted.** Putting
both in one table produces a table where half the rows' balances are computed
from the ledger and half are typed in, and every function that sums accounts
then has to know which kind it is holding. That is the second set of books §6.1
exists to prevent. Two tables make the distinction structural instead of a
convention someone has to remember.

`Reconciliation` is also not it: it records a _disagreement_ between a statement
and a computed balance, and resolves it with an adjustment transaction. A
valuation disagrees with nothing.

---

## I2 — The number: `/jmeni`

One new route. Czech: _jmění_ — what you are worth.

```
┌─────────────────────────────────────┐
│  Jmění                              │
│                                     │
│         1 284 320 Kč                │
│         celkem                      │
│                                     │
│   Na účtu          44 324,50        │
│   V investicích 1 239 995,50        │
│   ── investice k 3. 6. ──           │   ← only when something is stale
│                                     │
│  ┌───────────────────────────────┐  │
│  │ ● Penzijko          412 000   │  │
│  │   k 3. 6. · 47 dní     +8 200 │  │
│  │   vloženo 380 000 · růst 8 %  │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ● ETF               827 995   │  │
│  │   dnes                 −4 100 │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

Three rules govern this screen, and they are all the same rule:

1. **`celkem` is cash plus investments** — the ledger balance from
   `balanceOf()` plus the sum of current valuations. No double counting: the
   money that bought the ETF left the current account as an outflow months ago,
   so the two halves are disjoint by construction.
2. **A stale total says so.** When any holding's reading is older than its own
   cadence, the total carries the date of the **oldest** reading it depends on.
   A number from June printed in August with no date on it is a lie, and this
   app does not print those.
3. **Every row carries its as-of date.** `dnes` when it is today's, the short
   date and the age in days when it is not.

**Placement.** It is not a tab. The tab bar is the four things done repeatedly,
and a stock figure looked at monthly is not one of them. It is reached from:

- **the entry screen's slab header**, which already holds `Výpis` and
  `Nastavení` icon-links — a third icon, one tap from launch, costing zero
  vertical pixels on the screen with none to spare. It carries a flag dot when
  something is stale (I5).
- **a card on `/mesic`**, next to the split, which is where the month is being
  read anyway.

---

## I3 — Recording a value

The app already has an interaction for typing a number quickly, and this reuses
it rather than inventing a second one: **a `Sheet` containing the `Keypad`**, the
same `amount-input` state machine, and a date row identical to the entry
screen's.

```
┌───────────────────────────────┐
│  Penzijko                     │
│                               │
│        412 000 Kč             │
│  minule 403 800 · k 3. 6.     │
│  ▲ 8 200 · 2,0 %              │   ← live, updates while typing
│                               │
│  [ dnes ]                     │
│  [ 7 8 9 / 4 5 6 / 1 2 3 ]    │
│  [        Uložit        ]     │
└───────────────────────────────┘
```

The previous reading stays on screen while typing, with the delta computed live.
It is the cheapest available guard against a fat-fingered zero, and it is the
same idea as the entry screen showing the direction before the sign is read.

**One new check, `unlikely-valuation`** (`domain/holdings.ts`, `info` severity):
a value that has moved more than ±40 % since the last reading gets a line
saying so. It does not block — rule 7 — it just refuses to let a 4 120 000 Kč
pension go in silently.

---

## I4 — Contributions and growth

With `Holding.categoryId` set, the app can put two numbers next to each other
that have never been next to each other before:

- **vloženo** — outflows into that category since `holding.startDate`, read off
  the ledger, exactly the way goal progress is read.
- **růst** — current value minus vloženo.

`startDate` is there for the same reason `Goal.startDate` is (Q27): a holding
created today must not open already "funded" by four years of SPOŘENÍ it never
received.

**Growth is never income, and never enters the split.** It is unrealised, it did
not arrive in any account, and no allocation decision was made about it. It is
displayed as its own figure with its own word and it stops there. When the ETF
is actually sold, the money arriving is an ordinary inflow filed under an income
category, and _that_ is when the split hears about it — which is correct, and is
the same rule §6.1 already applies to `owedAmount`: an outstanding share is not
money until it lands.

**When attribution is impossible, the app says nothing rather than something
wrong.** If two live holdings point at the same category, contributions cannot
be split between them, and the honest output is no `vloženo` line on either row
plus one sentence saying why. This is **Q37**.

---

## I5 — The reminder

### What is actually possible

Stated plainly, because it constrains the design: **while the app is local-only
there is no way to raise a notification when it is closed.** Web Push needs a
server, which is P2. `Notification Triggers` never shipped. Anything claiming
otherwise would be a timer that only runs while the app is already open, which
is not a reminder.

So the reminder is built twice, in the right order:

### Now — a finding, in the app's own vocabulary

The app already has a shape for "something you usually do has not happened":
`findMissingRecurring`. A stale valuation is the same shape and gets the same
treatment.

```ts
staleValuation → Finding {
  severity: age > reminderDays * 2 ? 'warn' : 'info',
  title:  'Penzijko — hodnota je 47 dní stará',
  detail: 'Naposledy 3. 6. Aktualizuj ji, ať celkové jmění něco znamená.',
  fix:    { kind: 'value-holding', holdingId }   // one tap → the I3 sheet
}
```

It surfaces in exactly three places, and deliberately not a fourth:

| Where                         | How                                               |
| ----------------------------- | ------------------------------------------------- |
| `/mesic` findings list        | As a row, with the other month-level findings     |
| `/jmeni`, on the holding      | The age turns amber, the fix button appears       |
| `/` slab header, the new icon | A flag dot. No text, no count, no interruption    |
| ~~`/` checks strip~~          | **No.** That strip belongs to the row being typed |

The last line is the one worth defending. The entry screen's job is a
five-second transaction; a nag about a pension statement while a number is
half-typed is precisely the friction that killed the spreadsheet.

**Cadence is per holding** (`reminderDays`, default 30). A pension statement
arrives quarterly and a crypto wallet can be read in ten seconds — one global
interval would nag hardest about the thing that cannot be answered, and a
reminder that cannot be acted on gets trained away.

### Later — one nudge channel, not two

`TRIMMING-AND-TRAINING.md` R3 already designs a Web Push nudge for an empty day,
off by default, VAPID, Android primary. When that ships, the stale valuation
joins **the same channel and the same daily budget** — at most one notification
a day, and the empty-day nudge outranks it, because a missing day is
unrecoverable and a stale valuation is merely stale.

### And later still — where it really belongs

The monthly close ritual (R2) is a list of things that are true once a month.
"Update the valuations" is one of them and should become a step in it. At that
point the finding stops being the mechanism and becomes the thing that catches
the month the ritual was skipped.

---

## 2. New invariants — for `PROJECT-PLAN.md` §6.1

- **A valuation is not a transaction.** It never reaches `income`, `outflow`,
  `net`, `recurringOutflow`, any `BucketTotal`, or `prosperitySplit`.
  `summariseMonth` does not take holdings as input and must not be given them.
- **Unrealised growth is not income.** It is displayed as its own figure. Money
  from a holding enters the ledger only when it is actually sold, as an ordinary
  inflow.
- **Current value is the latest live reading, chosen in one place.**
  `currentValuation()` is the only function allowed to pick it.
- **A value is never shown without its date once it is older than its holding's
  cadence** — including inside the `celkem` total, which names the oldest
  reading it rests on.
- **Contributions are attributed only when the mapping is unambiguous.** Two
  live holdings on one category means no `vloženo` figure for either.

---

## 3. Schema — v4

New tables only, so no `upgrade` function.

```ts
{
  version: 4,
  stores: {
    holdings:   'id, sortOrder, categoryId',
    valuations: 'id, holdingId, date, [holdingId+date]'
  }
}
```

`SyncedEntity` gains `'holding' | 'valuation'`. Both tables carry the four sync
fields from the first line, per §4 — free now, a migration later.

---

## 4. Build order

|     | Item                                                            | Files                                                       | Cost | Depends on |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------- | ---- | ---------- |
| 1   | Types, schema v4, repo writes                                   | `domain/types.ts`, `db/schema.ts`, `db/repo.ts`             | S    | Q36        |
| 2   | `domain/holdings.ts` — pure, with its tests                     | new + `holdings.test.ts`                                    | M    | 1          |
| 3   | `/jmeni` — total, list, empty state                             | `routes/jmeni/+page.svelte`, `ui/Icon.svelte` (one glyph)   | M    | 2          |
| 4   | The valuation sheet — `Sheet` + `Keypad` + `unlikely-valuation` | `ui/ValuationSheet.svelte`                                  | M    | 3          |
| 5   | Manage holdings — add, rename, archive, cadence, linked bucket  | `routes/settings/+page.svelte` (a fifth section)            | S    | 3          |
| 6   | `staleValuation` finding + the three surfaces                   | `domain/holdings.ts`, `routes/mesic`, `routes/+page.svelte` | S    | 2, 3       |
| 7   | Contributions and growth                                        | `domain/holdings.ts`, `/jmeni`                              | S    | 2, Q37     |
| 8   | Fold into the R3 push channel                                   | —                                                           | S    | R3 (P3)    |

Items 1–4 are the feature. 5–7 are what make it worth opening twice.

### Tests

Added to §13's list:

- `currentValuation` — empty, one, many, two on the same date, all soft-deleted
- Staleness boundaries — exactly at `reminderDays`, one past, twice past
- Contribution attribution — before/after `startDate`, refunds into the bucket,
  and the two-holdings-one-category refusal
- `wealthTotal` — cash only, holdings only, both, negative cash
- **The invariant test:** the same `summariseMonth` and `prosperitySplit`
  fixtures, run with a full set of holdings and valuations in the database, and
  asserted byte-identical. This is the test that fails if anyone ever wires
  growth into income.

---

## 5. What this does not add

- **No prices, no tickers, no units, no cost basis, no API.** One number per
  holding, typed by hand. The §3 non-goal stands for everything except that.
- **No currency conversion.** CZK, as everywhere (§4).
- **No performance chart, no XIRR, no benchmark.** Two readings and a delta.
- **No second entry path.** Contributions stay ordinary outflows.
- **No new dependency** (rule 12), no new tab, and nothing on the entry screen
  but one icon and one dot.

---

## 6. Questions that need Petr before building

|         | Question                                                                                                     | Blocks | Recommendation                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------- |
| **Q36** | Is the §3 non-goal "investment portfolio tracking, net worth" reversed — for hand-typed values only?         | all    | Yes. Record it as a scoped reversal, with the §3 line amended rather than deleted                       |
| **Q37** | Two holdings on one category: show nothing, or split the contributions evenly?                               | I4     | Show nothing. An evenly split figure is wrong in a way nobody would catch                               |
| **Q38** | Does a property — a flat, a car — belong here at all, or only liquid holdings?                               | I1, I2 | Allow it, `kind: 'property'`, but ask again after a month. A number you cannot spend inflates `celkem`  |
| **Q39** | Should `celkem` include debt as a negative — the `loan` and `credit` account kinds already in `AccountKind`? | I2     | Not in v1. It is the honest figure but it is a second feature, and `/jmeni` should ship able to hold it |

Q38 is the one worth thinking about longest. A flat at 6 800 000 Kč makes the
total a number that is true and useless — every other figure on the screen
disappears next to it, and none of it can be spent. If it goes in, it likely
needs its own line rather than a place in the same sum.
