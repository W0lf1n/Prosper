# Laws 3 and 4 — what is left of Trimming and Training

**Status:** design, for the four mechanisms that are still unbuilt.
**Audience:** Claude Code (implementation), Petr (decisions)
**Reads with:** `PROJECT-PLAN.md` §2.3, §2.4 and `DECISIONS.md`

> This document used to carry nine mechanisms. Five of them shipped or were
> superseded, and their descriptions have gone with them — the app is what
> describes those now, and `PROJECT-PLAN.md` §2 says what each one does.
>
> What remains is **T2 caps**, **R2 the monthly close** and **R5 cap
> history**, plus two standing refusals that have to keep being refused.
> **R3, the nudge, shipped on 2026-10-18** as Upozornění (`DECISIONS.md`
> Q89–Q90); its section below now records what was built and where it
> departed from this design. The rest are blocked on a question in `TODO.md` §2.

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
  the workbook is eight months of evidence that budgets were not
  kept.

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

# R3 — The nudge · **built 2026-10-18**

Shipped as **Upozornění** (`/nastaveni/upozorneni`, `domain/notifications.ts`,
`lib/notify/`; `DECISIONS.md` Q89–Q90). What survived of the design above it,
and what changed:

- **Off by default, turned on from Nastavení** — as designed.
- **The hour is his** (Q32): a time field, opening on 21:00, rather than a
  guess the entry timestamps would one day confirm.
- **It is asked every evening, not only on an empty day.** The ask was "has
  everything been written", which a day with one row can still fail. The
  body says what today holds, and on an empty day it is this design's own
  line: _Dnešek je zatím prázdný._ It still asks for nothing — no confirm, no
  mark; a tap opens Zápis.
- **Two more notices joined it**: an `auto` payment that went, and a
  `confirm` one waiting. So "at most one notification a day" became "at most
  one of each kind he switched on". The stale-holding reminder would be a
  fourth switch on the same channel — never a second channel.
- **Web Push with VAPID, as designed — but empty.** The server sends a wake-up
  at instants the phone chose; the phone reads its own ledger and decides what
  to say. iOS is reached only when installed to the home screen, which is the
  degradation agreed in Q16.

**Still waiting on a deployed server with keys** (`TODO.md` §4.1). Until then
the notices come only while the app is open, and late through Android's
periodic background sync.

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
4. ~~**R3** nudge~~ — shipped 2026-10-18 (Q89); waits only on the push keys

## What none of this adds

- No AI categorisation. `vocabulary.ts` is a hand-written dictionary of Petr's
  own words and stays that way.
- No badges, levels, points, confetti, or streak-freeze mechanics.
- No advice text. The app states numbers and offers one tap. It does not explain
  compound interest.
- No new screen. Every mechanism lands where the eye already goes.
