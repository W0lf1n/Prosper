# Investments — what I own, and what it is worth today

**Status:** **built.** The model, `/jmeni`, the valuation sheet, holding
management, the stale-value finding, and contributions and growth all ship.
Q36–Q39 are ruled and recorded in `DECISIONS.md`.

One piece is outstanding and it is blocked rather than pending: folding the
stale-value reminder into a Web Push channel needs R3, which is unbuilt P3 work.
See the end of this document.
**Audience:** Claude Code (implementation), Petr (decisions)
**Reads with:** `PROJECT-PLAN.md` §3, §6, §6.1, §8 and `DECISIONS.md` Q36–Q39

> This document is written under two rules. The first is `PROJECT-PLAN.md` §2:
> **a feature that serves no law does not get built.** This one serves Targeting
> — a goal the size of a six-month reserve is not reached out of a current
> account, and until this shipped the app could not see the place it was
> actually being reached in.
>
> The second is harder: **a stated number and a computed number must never sit
> in the same column without saying which is which.** Everything else the app
> reports is derived from the ledger. An investment's value is not derivable
> from anything — it is a fact from outside, typed in by hand, and stale the
> moment after. Most of what follows is about keeping that difference visible
> instead of averaging it away.

---

## What must not break

Still true, and each line is load-bearing.

| Already true                                                | And this does not touch it                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Contributions are ordinary outflows into a `save` bucket    | Left exactly as they were. No new entry path                |
| `summariseMonth` decides income, outflow, net, buckets      | Never sees a holding. Not one line changed in `checks.ts`   |
| `prosperitySplit` measures shares against **income** (Q34)  | Never sees a holding. Growth is not income                  |
| Goal progress is read off the ledger, never stored          | Unchanged. A holding is not a goal and does not fund one    |
| Soft delete only; client ids; every write through `repo.ts` | Same rules, no exceptions                                   |
| `/` is the launch route and is protected hardest            | Gained one icon in a header that already had two. No height |

The third line is the important one. If a valuation ever reaches `income`, the
10 / 10 / 10 / 70 split silently becomes fiction — a month where the pension
moved up 8 000 Kč would report a healthy savings share out of money that was
never earned or allocated. **This is the failure mode the whole design is
arranged to make impossible**, and it has a test of its own in
`holdings.test.ts`: the same `summariseMonth` and `prosperitySplit` fixtures,
run with a full set of holdings in the database, asserted byte-identical.

---

## The model — a holding, and a series of readings

Two tables, `holdings` and `valuations`, added as schema **v4**. The
authoritative shapes are in `domain/types.ts`; `PROJECT-PLAN.md` §6 mirrors them.

**A series, not a `currentValue` column.** A mutable field would answer "what is
it worth" and lose the two things that make the answer usable: _when was that
true_, which the reminder runs on, and _what did it do since_, which is the only
reason to open the screen twice. It also matches the append-only shape of
everything else — nothing here is edited in place, and a wrong reading is soft
deleted like a wrong transaction.

**Current value** is the live valuation with the greatest `date`, breaking ties
on `createdAt`. `currentValuation()` is the only function allowed to pick it.
Two readings on one day is not hypothetical: it is what happens when a number is
typed wrong and typed again a minute later, and the second one has to win.

`HoldingKind` is `cash | savings | investment | crypto` — liquid and semi-liquid
only, per Q38. The `property` kind proposed in the first draft was dropped: a
flat at 6 800 000 Kč makes `celkem` a number that is true and useless, and if
property is ever tracked it needs a line of its own rather than a place in the
same sum.

`Holding.startDate` was in the first draft, left out of the first version, and
added as **schema v6** when contributions shipped. It exists for the same reason
`Goal.startDate` does (Q27): a holding written today must not open already
"funded" by four years of SPOŘENÍ it never received.

The v6 backfill takes the first of the month of the holding's earliest reading,
falling back to the current month for one never valued. Both are guesses and
both are conservative — they never claim a contribution the holding might not
have received — and both are one field away from being corrected: tap the
holding, then `Upravit investici`.

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

## The number — `/jmeni`

Czech: _jmění_ — what you are worth.

Three rules govern the screen, and they are all the same rule:

1. **`celkem` is cash plus investments** — the ledger balance from `balanceOf()`
   plus the sum of current valuations, shown as two named halves underneath. No
   double counting: the money that bought the ETF left the current account as an
   outflow months ago, so the two halves are disjoint by construction.
2. **A stale total says so.** When any holding's reading is older than its own
   cadence, `Wealth.restsOn` carries the date of the **oldest** reading the total
   depends on. A number from June printed in August with no date on it is a lie,
   and this app does not print those. A holding that has never been valued
   contributes zero and cannot make the total stale — zero is not a figure that
   can be out of date.
3. **Every row carries its as-of date**, and it turns amber once the reading is
   older than that holding's cadence.

**Placement.** Not a tab. The tab bar is the four things done repeatedly, and a
figure looked at monthly is not one of them. It is reached from the entry
screen's slab header, which already held `Výpis` and `Nastavení` icon links — a
third icon, one tap from launch, costing zero vertical pixels on the screen with
none to spare.

The `/mesic` card proposed in the first draft was not built, and is not planned.
The month view now carries the stale-value _finding_ instead, which is the part
that needs acting on; a second copy of the total there would be a number to look
at rather than a thing to do.

---

## Recording a value

**The first value goes in with the name** (since 2026-09-05, Q51). The
new-holding sheet carries a plain decimal field — _Hodnota teď_ — under the
name, the same phone-keyboard field the opening balance in Settings uses, and
saving writes the holding and today's reading in one go. It used to hand over
to the keypad for the number, and a sheet about an investment with nowhere on
it to type what the investment is worth read as an app that could not record
one. The field is only on a new holding: editing one never shows it, because a
value has its own sheet with the previous reading beside it, and a number
changed in passing while fixing a typo is precisely the reading nobody meant to
write. Left blank, the keypad still follows.

**Every value after the first** reuses the interaction the app already has for
typing a number quickly, rather than inventing a second one: a `Sheet`
containing the `Keypad`, the same `amount-input` state machine, and a date row
identical to the entry screen's (`ui/ValuationSheet.svelte`).

The previous reading stays on screen while typing, with the delta computed live.
It is the cheapest available guard against a fat-fingered zero, and it is the
same idea as the entry screen showing the direction before the sign is read.

`valuationWarning()` is the check: a value that has moved more than **±40 %**
since the last reading gets a line asking whether it is right. Forty per cent
sits above a normal month on anything in `HOLDING_KINDS` and below the smallest
typo that matters — an extra digit is always +900 %, a missing one always −90 %.
It does not block. Rule 7 has no exceptions.

---

## Contributions and growth

With `Holding.categoryId` set, the app puts two numbers next to each other that
have never been next to each other before:

- **vloženo** — outflows into that category since the holding started counting,
  read off the ledger, exactly the way goal progress is read.
- **růst** — current value minus vloženo.

**Growth is never income, and never enters the split.** It is unrealised,
it did not arrive in any account, and no allocation decision was made about it.
It gets its own figure with its own word — `růst`, beside `vloženo` — and it
stops there. When the ETF is actually sold, the money arriving is an ordinary
inflow filed under an income category, and _that_ is when the split hears about
it. It is the same rule §6.1 already applies to `owedAmount`: an outstanding
share is not money until it lands.

**When attribution is impossible, the app says nothing rather than something
wrong.** If two live holdings point at the same category, contributions cannot
be split between them, and the honest output is no `vloženo` line on either row
plus one sentence saying why. Ruled as **Q37**.

---

## The reminder

### What was possible, and what it forced

Stated plainly, because it shaped the design: **while the app was local-only
there was no way to raise a notification when it was closed.** Web Push needs a
server. `Notification Triggers` never shipped. Anything claiming otherwise would
have been a timer that only runs while the app is already open, which is not a
reminder.

So the reminder was built as a **finding** instead — the shape the app already
had for "something you usually do has not happened", the same one
`findMissingRecurring` uses.

```ts
staleValuation → Finding {
  severity: isOverdue ? 'warn' : 'info',   // past twice its own cadence
  title:  'Penzijko — hodnota je 58 dní stará',
  detail: 'Naposledy 30. 6. Aktualizuj ji, ať celkové jmění něco znamená.',
  fix:    { kind: 'value-holding', holdingId }
}
```

It surfaces in exactly four places, and deliberately not a fifth:

| Where                        | How                                                                  |
| ---------------------------- | -------------------------------------------------------------------- |
| `/jmeni`, above the list     | The _Připomínky_ slab: every finding in full, _Zapsat hodnotu_ opens the keypad |
| `/jmeni`, on the holding     | The row counts down to its reminder, and past it counts up, in amber |
| `/mesic` findings list       | A row among the month's other findings, with a fix                   |
| `/` slab header, on the icon | A flag dot. No text, no count, no interruption                       |
| ~~`/` checks strip~~         | **No.** That strip belongs to the row being typed                    |

The first two arrived on 2026-09-05 (Q51). Until then the cadence was a fact
visible only inside the edit sheet, so a holding given _30 dní_ looked, on the
screen it lives on, exactly like one given nothing — and a reminder nobody can
see is not one.

The last line is the one worth defending. The entry screen's job is a
five-second transaction; a nag about a pension statement while a number is
half-typed is precisely the friction that killed the spreadsheet.

**Cadence is per holding** (`reminderDays`, default 30). A pension statement
arrives quarterly and a crypto wallet can be read in ten seconds — one global
interval would nag hardest about the thing that cannot be answered, and a
reminder that cannot be acted on gets trained away. Three presets — 7, 30, 90
— and _jinak_, any whole number of days up to a year (`REMINDER_PRESETS`,
`MAX_REMINDER_DAYS`, `isValidReminderDays` in `domain/holdings.ts`).

### What is left, and why it is blocked

A server now exists, so Web Push is possible in principle. It is still not
built, and the dependency runs the other way from what it looks like:

`TRIMMING-AND-TRAINING.md` **R3** designs the one nudge channel — an empty-day
reminder, off by default, VAPID, Android primary. The stale valuation is meant
to join **that** channel and **that** daily budget, at most one notification a
day, with the empty-day nudge outranking it because a missing day is
unrecoverable and a stale valuation is merely stale.

So this waits on R3, which is unbuilt P3 work behind the 14-day gate. Building a
second push channel first would be building the thing R3 exists to prevent.

### And later still — where it really belongs

The monthly close ritual (R2) is a list of things that are true once a month.
"Update the valuations" is one of them and should become a step in it. At that
point the finding stops being the mechanism and becomes the thing that catches
the month the ritual was skipped.

---

## What this does not add

- **No prices, no tickers, no units, no cost basis, no API.** One number per
  holding, typed by hand. The §3 non-goal stands for everything except that.
- **No currency conversion.** CZK, as everywhere.
- **No performance chart, no XIRR, no benchmark.** Two readings and a delta.
- **No second entry path.** Contributions stay ordinary outflows.
- **No debt in `celkem`** (Q39). It is a pure assets total in v1. `AccountKind`
  already carries `loan` and `credit`, and a mortgage balance is the same shape
  as a holding with the sign turned round — stated from outside, stale by
  default — but netting it off is a second feature, and `Wealth` is shaped to
  hold it when it arrives.
- **No new dependency** (rule 12), no new tab, and nothing on the entry screen
  but one icon and one dot.
