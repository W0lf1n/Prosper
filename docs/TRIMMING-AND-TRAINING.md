# Laws 3 and 4 — Trimming and Training

**Status:** design, not built. Targeting shipped 2026-08-24; this is what comes
after it.
**Audience:** Claude Code (implementation), Petr (decisions)
**Reads with:** `PROJECT-PLAN.md` §2.3, §2.4 and `DECISIONS.md`

> The rule this document is written under is the same one in `PROJECT-PLAN.md`
> §2: **a feature that serves no law does not get built, and a law that has no
> mechanism is a page of advice.** Every item below is a thing the app _does_,
> at a moment it can still matter, with a number from the workbook behind it.
>
> Nothing here should be started before the 14-day gate in §11 has passed. Real
> usage will kill some of it, and that is cheaper to find out now.

---

## 0. What is already true

Neither law starts from zero. Trimming in particular is mostly _already
enforced_, at entry time, because spending that hides in the wrong bucket cannot
be trimmed at all.

| Already shipped                                                       | Which law |
| --------------------------------------------------------------------- | --------- |
| `spendType` on every category — `need` / `want` / `save` / `debt`     | Trimming  |
| POTRAVINY split from JÍDLO, so the discretionary half is separable    | Trimming  |
| `misfiled`, `vague`, `other-overflow`, `unclear-number` checks        | Trimming  |
| `Txn.isOneOff` and a separate "běžný chod měsíce" figure              | Trimming  |
| `Category.monthlyCap` — **in the schema, null everywhere, unused**    | Trimming  |
| Checks run on every keystroke and never block a save                  | Training  |
| `missing-recurring` — a subscription that vanished becomes a question | Training  |
| Gap days as visible holes; `DayMark` for a real zero                  | Training  |
| Undo on every save                                                    | Training  |

So the work below is: **give Trimming a target to trim towards** (the cap
column that already exists), and **give Training a loop that closes** (the
monthly ritual, and a reason to come back tomorrow).

---

# Law 3 — Trimming

> _"Necessary" expenses expand to match income._

The book's move is not "spend less". It is: pick **one** category, set a number
that is lower than what you actually spent, and defend it for a month. One at a
time, from evidence, with a deadline.

## T1 — The need/want/save split, stated as one number

**The gap:** `/mesic` ranks buckets by size and colours the bars by `spendType`,
but never adds them up. The single most actionable number in the whole book —
_what share of my outflow was discretionary_ — is on screen as four colours and
no figure.

**The mechanism:** one line at the top of `/mesic`:

```
Nutné 61 %  ·  Chtěné 27 %  ·  Spoření 12 %
```

and, underneath, the only sentence that matters:

> Chtěné výdaje: **17 340 Kč**. To je to, s čím se dá něco dělat.

Month-over-month delta beside it once there are two months (`↓ 4 %` / `↑ 6 %`).

**Where:** `domain/checks.ts` → extend `MonthSummary` with a `split` field
(`{ need, want, save, debt }` totals plus percentages, computed from the same
`spendRows` that already exist). Pure, testable, no new query.

**Why it is first:** it costs one derived value over data already loaded, and it
is the number every later Trimming feature refers to.

## T2 — Caps: one per month, chosen from evidence

`Category.monthlyCap` exists and is `null` on every row. Turning it on is the
core of this law.

**The refusal that makes it work** — the same shape as the Goal form:

- A cap may only be set on a bucket **with at least two months of history**.
  Capping a bucket you have never measured is guessing, and a guessed cap gets
  broken and then ignored.
- The app proposes the number: _last month's spend minus 10 %_, rounded to the
  nearest 100 Kč. He can change it, but the default is evidence.
- **At most one _new_ cap per month.** This is the book's whole method and the
  single most important constraint in this document. Three caps at once is a
  budget, budgets fail, and the workbook is eight months of evidence that this
  particular person does not keep one.

**In the ledger, at entry time** — a cap is worthless if it is only visible in a
report. When a category with a cap is selected on `/`, the chip carries its
remaining room:

```
[POTRAVINY]  [JÍDLO 620 ←]  [BYDLENÍ]
```

and once the cap is passed, a `checkDraft` finding — **info, never a block**
(§13.7):

> JÍDLO je 340 Kč nad limitem. Do konce měsíce zbývá 6 dní.

**In `/mesic`** — capped buckets get a second marker on their bar at the cap
position, so overspend is visible as a bar crossing a line rather than as a
number you have to compare.

**Model:** no schema change. `monthlyCap: Minor | null` is already there.

**Open question for Petr:** a cap that is broken every month is a wrong cap, not
a failure. Should the app offer to raise it after the second consecutive break,
or stay silent? _Recommendation: offer, once, with the actual average beside it._
A cap you have privately stopped believing in is worse than no cap.

## T3 — Subscriptions, named as a class

**Evidence:** twelve subscriptions retyped by hand every month in the workbook.
Netflix at 74 Kč with "379" in the description. HBO Max at −18 Kč, twice.

**The mechanism:** the app already detects recurring payees for
`missing-recurring`. Reuse that detection for a **Předplatné** panel on `/mesic`:
every payee seen in ≥ 3 of the last 4 months, with its monthly cost, its annual
cost, and the date it was last paid.

The annual figure is the point. `379 Kč/měs` is a rounding error;
**`4 548 Kč/rok`** is a decision. Show both, always, with the year in bold.

**Where:** `domain/recurring.ts` — new, pure. Lift the detection out of
`checks.ts` → `findMissingRecurring`, which currently owns it privately, and have
both callers use it.

## T4 — OSTATNÍ, actively drained

`other-overflow` already fires when OSTATNÍ passes 15 % of recurring outflow.
It states the problem and stops there.

**The mechanism:** make the finding actionable. Tapping it opens a sheet listing
that month's OSTATNÍ rows, each with a one-tap re-file into the bucket the
vocabulary suggests. The workbook says 100 895 Kč went through this bucket in
eight months; a finding that cannot be acted on is a finding that gets scrolled
past.

## T5 — Trimming's own screen? **No.**

Deliberate non-goal. Every mechanism above lands on a screen that already
exists: the entry chip, the month card, the check line. A dedicated "úspory"
screen would be a place to feel virtuous rather than a place where behaviour
changes, and it would be the sixth screen in an app whose whole argument is that
Excel lost on friction.

## Trimming — build order

|     | Item                                                | Cost | Depends on                |
| --- | --------------------------------------------------- | ---- | ------------------------- |
| 1   | T1 need/want/save line                              | S    | nothing                   |
| 2   | T3 subscriptions panel                              | S    | `recurring.ts` extraction |
| 3   | T2 caps — model + `/settings` + `/mesic` marker     | M    | T1                        |
| 4   | T2 caps — the chip counter and the entry-time check | M    | above                     |
| 5   | T4 OSTATNÍ re-file sheet                            | S    | nothing                   |

---

# Law 4 — Training

> _Repetition until it is a habit._

The checks already train continuously — a hundred small corrections rather than
one monthly lecture. What is missing is the part that makes the habit _visible
to the person having it_, and the ritual that closes a month rather than letting
it trail off.

The danger with this law is obvious and worth writing down: **gamification is
how you get an app that is fun for three weeks.** Everything below is designed
to be quiet, honest, and to say nothing when there is nothing to say.

## R1 — Days covered, and the streak

**Evidence:** the spreadsheet had no dates at all. Coverage was not merely low;
it was _unmeasurable_. The `coverage` check already computes it.

**The mechanism:** a ring on `/mesic`, and one figure on `/`:

- Ring: days recorded ÷ days elapsed this month, not ÷ days in month — otherwise
  it reads as failure on the 3rd of the month.
- A day counts if it has a transaction **or** an explicit `DayMark`. That is why
  `DayMark` exists.
- **Streak = consecutive covered days, ending today or yesterday.** Yesterday
  included, deliberately: a streak that dies at 00:00 punishes the person who
  records at breakfast, and a streak you can lose in your sleep is a streak you
  stop caring about.

**Where it must not go:** the entry screen's primary column. Coverage is a
review number. One small figure in the totals slab is the whole budget for it.

## R2 — The monthly close ritual

The biggest single item in this document, and the one the book is most explicit
about. `/mesic` currently _shows_ a month. It has no way to **finish** one.

A five-step sheet, launched from `/mesic` on the 1st (and available any time),
each step one tap, the whole thing under two minutes:

| Step | What it asks                                                                               | Reads from            |
| ---- | ------------------------------------------------------------------------------------------ | --------------------- |
| 1    | **Zkontroluj díry.** Days with no record, each with "nic jsem neutratil" or a quick entry. | `coverage`, `DayMark` |
| 2    | **Srovnej se s bankou.** Statement balance in; the delta becomes an adjustment row.        | Reconciliation (P3)   |
| 3    | **Podívej se na rozdělení.** The need/want/save line, and last month beside it.            | T1                    |
| 4    | **Nastav jeden limit.** One bucket, one number, proposed from evidence.                    | T2                    |
| 5    | **Napiš jednu větu.** What happened this month, in his own words.                          | new `MonthNote`       |

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

**Migration:** schema v3, one new store, `monthCloses: 'id, month'`.

## R3 — The nudge

One notification, at most, per day: **21:00, only if today has no record and no
`DayMark`.** Not a summary, not a tip. One line:

> Dnešek je zatím prázdný.

Tapping it opens `/` with the keypad focused.

Android is primary (Q16), so Web Push with VAPID works; iOS degrades to nothing,
which is the agreed position. **Off by default, turned on from `/settings`.** A
finance app that nags without being asked gets uninstalled, and this one only
has to survive one user.

## R4 — Health score — **rejected**

The plan's §2.4 lists a "health score". It should not be built.

A single number compounded from coverage, savings rate, cap adherence and net
would be **uninterpretable when it moves** — the one thing a training signal
must never be. If it drops four points he cannot tell whether he missed two days
or blew the food budget, and a signal you cannot act on is noise with a
reputation.

The three real numbers — coverage, the want share, caps held — are each
individually actionable and already on the screen. Replace the score with those.

_This overrides `PROJECT-PLAN.md` §2.4. Recorded here for a ruling._

## R5 — Consistency, shown as a record

The Goal screen's month history (`monthHistory`, shipped) is already this shape:
a column of months with ✓ or ✗ against a written target. Extend the same
treatment to caps once T2 exists.

Four ✓ in a row is the book's actual claim about training, and it is worth more
than any score because each mark refers to a specific number he committed to.

## Training — build order

|     | Item                              | Cost | Depends on          |
| --- | --------------------------------- | ---- | ------------------- |
| 1   | R1 coverage ring + streak         | S    | nothing             |
| 2   | R2 monthly close, steps 1 · 3 · 5 | M    | T1                  |
| 3   | R2 step 2 — reconciliation        | M    | Reconcile flow (P3) |
| 4   | R2 step 4 — set one cap           | S    | T2                  |
| 5   | R3 nudge                          | M    | service worker push |
| 6   | R5 cap history                    | S    | T2                  |

---

## The order across both laws

Interleaved, because the monthly close is what makes a cap stick and the split
is what makes a cap worth setting.

1. **T1** need/want/save line — everything else refers to it
2. **R1** coverage ring and streak — cheap, and it is the Tracking law finally reporting on itself
3. **T3** subscriptions with the annual figure
4. **R2** monthly close, without reconciliation
5. **T2** caps, end to end
6. **R2** close gains "set one cap" and reconciliation
7. **T4** OSTATNÍ re-file, **R5** cap history, **R3** nudge

## What this does not add

- No AI categorisation. `vocabulary.ts` is a hand-written dictionary of Petr's
  own words and stays that way (§3, non-goals).
- No badges, levels, points, confetti, or streak-freeze mechanics.
- No advice text. The app states numbers and offers one tap. It does not explain
  compound interest.
- No sixth and seventh screen. Every mechanism lands where the eye already goes.

## Questions that need Petr before building

|     | Question                                                                               | Blocks | Recommendation                                                 |
| --- | -------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| A   | Does a broken cap get raised automatically after two months, or stay?                  | T2     | Offer once, with the real average beside it                    |
| B   | Is the health score genuinely dropped?                                                 | R4     | Yes — drop it, keep three separate numbers                     |
| C   | Is a monthly close that is never _finished_ still useful, or must step 5 be mandatory? | R2     | Mandatory, like `Goal.why`. An unfinished close is a wish      |
| D   | Nudge at 21:00 — right hour?                                                           | R3     | Ask after the 14-day gate; the entry timestamps will answer it |
