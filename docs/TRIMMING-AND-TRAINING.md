# Laws 3 and 4 — what is left of Trimming and Training

**Status:** design, for the four mechanisms that are still unbuilt.
**Audience:** Claude Code (implementation), Petr (decisions)
**Reads with:** `PROJECT-PLAN.md` §2.3, §2.4 and `DECISIONS.md`

> This document used to carry nine mechanisms. Five of them shipped or were
> superseded, and their descriptions have gone with them — the app is what
> describes those now, and `PROJECT-PLAN.md` §2 says what each one does.
>
> What remains is **T2 caps**, **R2 the monthly close**, **R3 the nudge** and
> **R5 cap history**, plus two standing refusals that have to keep being
> refused. Three of the four are blocked on a question in `TODO.md` §5.

---

## What already carries these two laws

Neither law starts from zero, and the parts that are done are the parts that run
without being asked:

**Trimming** — `spendType` on every bucket · POTRAVINY split from JÍDLO ·
`misfiled`, `vague`, `other-overflow` and `unclear-number` at entry time ·
`Txn.isOneOff` and a separate "běžný chod měsíce" figure · the 10/10/10/70
split against income · declared recurring payments with the annual figure ·
draining OSTATNÍ one row at a time.

**Training** — checks on every keystroke, none of which block · the record of
months against a written target · days without an expense and the run of them ·
undo on every save.

**What is missing is the same thing in both laws: a number to aim at, and a
moment to look back.** T2 is the first. R2 is the second.

---

# T2 — Caps: one per month, chosen from evidence

`Category.monthlyCap` exists and is `null` on every row. Turning it on is the
core of this law, and the book's actual method: pick **one** category, set a
number lower than what you actually spent, and defend it for a month.

**The refusal that makes it work** — the same shape as the Goal form:

- A cap may only be set on a bucket **with at least two months of history**.
  Capping a bucket you have never measured is guessing, and a guessed cap gets
  broken and then ignored.
- The app proposes the number: _last month's spend minus 10 %_, rounded to the
  nearest 100 Kč. He can change it, but the default is evidence.
- **At most one _new_ cap per month.** This is the single most important
  constraint in this document. Three caps at once is a budget, budgets fail, and
  the workbook is eight months of evidence that this particular person does not
  keep one.

**In the ledger, at entry time** — a cap is worthless if it is only visible in a
report. When a capped category is selected on `/`, the chip carries its
remaining room:

```
[POTRAVINY]  [JÍDLO 620 ←]  [BYDLENÍ]
```

and once the cap is passed, a `checkDraft` finding — **info, never a block**
(§13.7):

> JÍDLO je 340 Kč nad limitem. Do konce měsíce zbývá 6 dní.

**In `/mesic`** — capped buckets get a second marker on their bar at the cap
position, so overspend reads as a bar crossing a line rather than as two numbers
to compare.

**Model:** no schema change. `monthlyCap: Minor | null` is already there.

**Blocked on Q29:** a cap that is broken every month is a wrong cap, not a
failure. Does the app offer to raise it after the second consecutive break, or
stay silent? _Recommendation: offer, once, with the actual average beside it._ A
cap you have privately stopped believing in is worse than no cap.

---

# R2 — The monthly close ritual

The biggest single item left, and the one the book is most explicit about.
`/mesic` _shows_ a month. It has no way to **finish** one.

A five-step sheet, launched from `/mesic` on the 1st and available any time,
each step one tap, the whole thing under two minutes:

| Step | What it asks                                                                               | Reads from               |
| ---- | ------------------------------------------------------------------------------------------ | ------------------------ |
| 1    | **Doplň, na co sis vzpomněl.** The month's days, each one a quick entry away.               | the tape — **built**     |
| 2    | **Srovnej se s bankou.** Statement balance in; the delta becomes an adjustment row.        | `reconcile` — **built**  |
| 3    | **Podívej se na rozdělení.** The split, and last month beside it.                          | `prosperity` — **built** |
| 4    | **Nastav jeden limit.** One bucket, one number, proposed from evidence.                    | T2                       |
| 5    | **Napiš jednu větu.** What happened this month, in his own words.                          | new `MonthClose`         |

**Four of the five steps now only have to be called.** Coverage, reconciliation
and the split all exist as screens and pure functions; the ritual is the thread
that puts them in an order and refuses to end until step 5 is written.

**Step 5 is not decoration.** It is the same mechanism as the Goal's `why`: a
sentence he wrote is the only part of a month that survives being forgotten.
Next month's close shows last month's sentence at the top. That is the loop.

**Model:** one new entity.

```ts
interface MonthClose extends Synced {
	id: string;
	month: string; // YYYY-MM
	closedAt: IsoDateTime;
	note: string; // his sentence — required, like `Goal.why`
	daysCovered: number; // snapshotted: the record of what was true then
	needPct: number;
	wantPct: number;
	savePct: number;
}
```

Snapshotting the percentages rather than recomputing them is deliberate: a
closed month is a record of what he saw and decided, and editing an old
transaction should not silently rewrite that.

**Migration:** a new entry in the `migrations` array, one new store,
`monthCloses: 'id, month'`.

**Blocked on Q31:** must the written sentence be mandatory? _Recommendation:
yes, like `Goal.why`. An unfinished close is a wish._

---

# R3 — The nudge

One notification, at most, per day: **21:00, only if today has no record.** (It
said "no record and no `DayMark`" until 2026-08-28; there is no mark any more,
and the question it guarded — is this a real zero or a forgotten day — is one the
app has stopped asking.) Not a summary, not a tip. One line:

> Dnešek je zatím prázdný.

Tapping it opens `/` with the keypad focused.

Android is primary (Q16), so Web Push with VAPID works; iOS degrades to nothing,
which is the agreed position. **Off by default, turned on from `/nastaveni`.** A
finance app that nags without being asked gets uninstalled, and this one only
has to survive one user.

**This is the one channel.** The stale-holding reminder in `INVESTMENTS.md`
joins it rather than opening a second — at most one notification a day, and the
empty-day nudge outranks the stale valuation, because a missing day is
unrecoverable and a stale valuation is merely stale.

**Blocked on Q32** (is 21:00 the right hour — the entry timestamps will answer
it after the gate) **and on a deployed server**: Web Push needs VAPID and a push
subscription, neither of which exists until the API is actually running
somewhere.

---

# R5 — Consistency, shown as a record

The Goal screen's month history is already this shape: a column of months with ✓
or ✗ against a written target. Extend the same treatment to caps once T2 exists.

Four ✓ in a row is the book's actual claim about training, and it is worth more
than any score because each mark refers to a specific number he committed to.

**Blocked on T2**, which is blocked on Q29.

---

## Two things that must keep being refused

### A health score — **rejected**

`PROJECT-PLAN.md` §2.4 lists one. It should not be built.

A single number compounded from no-spend days, savings rate, cap adherence and net is
**uninterpretable when it moves** — the one thing a training signal must never
be. If it drops four points he cannot tell whether he missed two days or blew the
food budget, and a signal you cannot act on is noise with a reputation.

The three real numbers — days without an expense, the want share, caps held —
are each individually actionable and two of the three are already on screen. That
is the replacement.

_Recorded as Q30 in `TODO.md` §5, and still needing one word to become a formal
decision rather than a strong recommendation._

### A screen of its own for Trimming — **no**

Every mechanism above lands on a screen that already exists: the entry chip, the
month card, the check line, a sheet over one of them. A dedicated "úspory"
screen would be a place to feel virtuous rather than a place where behaviour
changes, and it would be the seventh screen in an app whose whole argument is
that Excel lost on friction.

---

## The order, when the gate passes

1. **T2** caps, end to end — the number to aim at
2. **R2** monthly close — the moment to look back, now that four of its five
   steps only need calling
3. **R5** cap history — free once T2 exists
4. **R3** nudge — last, because it needs a server as well as an answer

## What none of this adds

- No AI categorisation. `vocabulary.ts` is a hand-written dictionary of Petr's
  own words and stays that way.
- No badges, levels, points, confetti, or streak-freeze mechanics.
- No advice text. The app states numbers and offers one tap. It does not explain
  compound interest.
- No new screen. Every mechanism lands where the eye already goes.
