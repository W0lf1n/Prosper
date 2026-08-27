# Recurring payments — declared, not detected

**Status:** **built and shipped** 2026-08-25. Ruled as Q40 in `DECISIONS.md`.
What was deliberately left out is in `TODO.md` §4.4.
**Audience:** Claude Code (implementation), Petr (decisions)
**Reads with:** `PROJECT-PLAN.md` §2.3, §6.1, §7 and `TRIMMING-AND-TRAINING.md` T3

> Two questions produced this, and they turned out to be one feature:
> _"can I say what a category costs every month and when it leaves the
> account"_, and _"how do I make the mortgage charge me on its own"_.
>
> The app could already **detect** repetition — `findMissingRecurring` notices a
> payee present in three months and absent from a fourth. Detection can only
> ever be statistical. A declaration says what is owed, to whom, out of which
> bucket and on which day, so a payment that did not arrive becomes a fact.

---

## 0. The ruling that shaped it

Auto-posting cuts against the Tracking law. Money that appears in the ledger
without anyone looking at it is exactly the state the spreadsheet left him in,
and the act of recording is supposed to be what creates the awareness.

Against that: retyping a fixed mortgage every month is not awareness, it is data
entry. That decision was made once, years ago. Re-making it monthly teaches
nothing and costs the five seconds the whole app is built around.

**Ruled (Q40): both, per schedule, defaulting to `confirm`.**

| Mode      | What happens                                                                                              | For                                     |
| --------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `confirm` | On the due day a strip appears on the entry screen. One tap accepts it, and the amount is editable first. | Anything that varies — utilities, cards |
| `auto`    | Written on the next launch, `source: 'recurring'`, linked to the schedule.                                | The mortgage, insurance — fixed sums    |

Petr's mortgage is set to `auto`. Everything else starts at `confirm`.

---

## 1. The model

```ts
export type ScheduleMode = 'confirm' | 'auto';

export interface Schedule extends Synced {
	id: string;
	payee: string; // goes into the rows it makes
	categoryId: string;
	amount: Minor; // signed, like Txn — the sheet takes the sign from the category
	dayOfMonth: number; // 1–31, clamped into short months
	startMonth: string; // YYYY-MM
	endMonth: string | null; // inclusive; null for an open-ended subscription
	mode: ScheduleMode;
	lastPostedMonth: string | null;
	isArchived: boolean;
	sortOrder: number;
}
```

`Txn` gains **`scheduleId: string | null`** — null for everything typed by hand,
which is most of the ledger. It is what tells "the mortgage went out" from "a
payment that looks like the mortgage".

### `lastPostedMonth` is a watermark, not a derivation

It moves forward when a month is **settled**, and a month is settled whether a
row was posted or the month was deliberately skipped — "I already typed this
one" and "it did not go out this month" are the same fact to the next launch.

Three things fall out of it, and all three are the reason it is stored rather
than computed from the ledger:

- **Posting is idempotent.** Opening the app four times on the 16th writes one
  row, not four.
- **Deleting a posted row does not resurrect it.** A derived version would see
  the gap and post it again on the next launch, forever.
- **Skipping is expressible at all.** There is no row to derive "we skipped
  July" from.

---

## 2. When it fires

There is no server, so nothing happens while the app is closed. The catch-up
runs on launch, in `+layout.ts`, next to `closePreviousDay()` — which is the
same shape of problem and already the established answer.

A month is due when its day has **passed** (the day itself counts, the day after
is not required) and the schedule is not yet settled for it.

Three guards, each of them load-bearing:

- **Short months clamp, never spill.** The 31st of February is the 28th. Moving
  it into March would put a January payment in the wrong month's totals.
- **Catch-up is bounded** at `MAX_CATCH_UP_MONTHS` (12). A phone left in a
  drawer over the summer comes back with its standing orders recorded; a start
  month mistyped as 2019 does not silently write sixty rows.
- **The date on the row is the day declared.** The app cannot know when the bank
  actually moved the money. Checking that against reality is reconciliation, and
  that is P3.

### One instance at a time

The confirmation strip offers the **oldest** month each schedule still owes, and
one per schedule (`dueGroups`), with a `+3` badge for the rest.

This is not a simplification, it is a correctness requirement. The watermark is
a high-water mark: confirming August before May would mark May settled without
ever having shown it. Oldest-first, one at a time, and the next appears when
this one is dealt with.

---

## 3. The surfaces

### The strip — entry screen

One row, under the month slab, **and nothing at all when nothing is due.** The
screen the five-second budget belongs to keeps exactly the height it had —
measured: the keypad sits at the same pixel either way.

It is under the totals rather than beside the checks on purpose. The checks
strip belongs to the row being typed; this belongs to the ledger, the same way
the totals do. A nag about Netflix in the middle of a half-typed amount is the
friction this app exists to avoid.

Tapping it opens a sheet: the payee, the day, an editable amount, **Přeskočit**
and **Zapsat**.

**The amount override never touches the schedule.** The gas bill is 2 800 Kč
most months and 4 100 Kč in February; correcting one month must not silently
rewrite the standing order. Verified: confirming Netflix at 429 Kč wrote a
429 Kč row and left the schedule at 379 Kč.

### Settings — Pravidelné platby

Its own list under KATEGORIE, where he went looking for it — but a list, not a
field on a category: Netflix and Spotify are both LIFESTYLE and they are two
different standing orders.

Each row shows the amount, the day, the bucket, the mode, and **the year**:

```
hypo Zenklova    27 000,00 Kč
15. · BYDLENÍ · automaticky    zbývá 124 plateb · 3 348 000,00 Kč

Netflix             379,00 Kč
3. · LIFESTYLE · potvrdit               4 548,00 Kč / rok
───────────────────────────────────────
Za měsíc                        27 379,00 Kč
Za rok                         328 548,00 Kč
```

The annual figure is what this section is for, and it is T3's argument
delivered: `379 Kč/měs` is a rounding error, `4 548 Kč/rok` is a decision. It is
shown live in the sheet too, while the monthly figure is still being typed —
which is the moment it can still change the answer.

**`zbývá 124 plateb`** is the mortgage question answered out of the ledger
alone. A schedule with an end month knows how many payments are left and what
they add up to, without a second kind of stated number and without the debt
balance that Q39 deliberately left out of v1.

---

## 4. What it does not change

- **No new entry path.** A confirmed payment is an ordinary `Txn` in an ordinary
  bucket. The mortgage is `debt`-typed spending and lands in the split's third
  allocation exactly as a hand-typed one would.
- **No check is weakened.** `duplicate` still fires if a scheduled row is also
  typed by hand — same amount, same description.
- **`findMissingRecurring` stays.** It covers everything _not_ declared, which
  is the point at which a payee is worth declaring.
- **Nothing blocks.** Skipping is one tap and needs no reason.

---

## 5. Files

| File                           | What                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `domain/recurring.ts`          | Pure: due dates, catch-up, grouping, annual cost, payments left            |
| `domain/recurring.test.ts`     | 28 tests                                                                   |
| `domain/types.ts`              | `Schedule`, `ScheduleMode`, `Txn.scheduleId`                               |
| `db/schema.ts`                 | Migration **v5** — `schedules`, `scheduleId` index, backfill               |
| `db/repo.ts`                   | `createSchedule` … `confirmScheduled`, `skipScheduled`, `catchUpSchedules` |
| `routes/+layout.ts`            | The launch catch-up                                                        |
| `ui/DueStrip.svelte`           | The strip and its sheet                                                    |
| `ui/ScheduleSheet.svelte`      | Declaring and editing one                                                  |
| `routes/settings/+page.svelte` | The list, the modes, the annual total                                      |

The v5 migration restates `txns` in full, because Dexie replaces the whole
declaration for a table it is given and every existing index has to be repeated
or it is dropped. It backfills `scheduleId: null` on existing rows rather than
leaving the field absent — an index over `undefined` works, but
`row.scheduleId === null` would then answer false for the entire pre-existing
ledger, and that is the kind of difference that surfaces months later as one
screen disagreeing with another.

---

## 6. What is next

Four things were named as "not now" when this shipped, and none has changed:
promotion to `auto` after three identical confirmed months, exact
missing-payment detection, the T3 subscriptions panel on `/mesic`, and cadences
other than monthly.

The reasoning for each is in `TODO.md` §4.4, which is the only place they are
tracked. The short version: every payment in the workbook is monthly, and a
cadence engine for a case that does not exist is the kind of generality
`PROJECT-PLAN.md` §3 spent effort keeping out.
