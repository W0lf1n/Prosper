# Decisions

One entry per question from PROJECT-PLAN §2, plus anything the plan turned out to
get wrong. Required by §11.12.

Laws 3 and 4 have their own design document, `TRIMMING-AND-TRAINING.md`; the
rulings it needs are Q29–Q32 below.

Status: **answered** — decided, implemented. **assumed** — the plan's own
recommendation applied without confirmation; cheap to revisit. **open** — still
needs Petr.

---

## Answered

### Q9 — Frontend framework · answered 2026-08-23

**SvelteKit 2 + TypeScript (strict).** Confirmed by Petr against the React
alternative.

Bundle budget was the deciding factor and it held: the entry route ships
**69 kB of JavaScript brotli-compressed**, checks engine included, against a
150 kB budget. React + Vite
would have spent roughly that much before any application code.

Actual versions: SvelteKit 2.63, Svelte 5.56 (runes mode forced), Vite 8, TS 6.

### Q20 — UI language · answered 2026-08-23

**Czech only.** Code, identifiers, comments and this document stay English.
All money and dates go through `Intl` with the `cs-CZ` locale — never
hand-rolled (§11.9).

### Q16 — Phone platform · answered 2026-08-23

**Android primary, iOS kept working as a degraded case.** So the P3 nudge can
use Web Push (VAPID) without an iOS-shaped compromise. Nothing in P1 depends on
it.

### Q12 — Client storage · answered 2026-08-23

**Dexie 4.4.5.** Schema v1 lives in `apps/web/src/lib/db/schema.ts` behind a
`migrations` array — a schema change is a new entry in that array, never an edit
to an existing one, because a released version is already on the phone.

One deviation from the plan's model, forced by IndexedDB rather than chosen:
**booleans cannot be indexed**, so `isDeleted` and `isArchived` are stored but
not indexed, and are filtered in memory.

### Q15 — Money representation · answered 2026-08-23

**`number` in minor units (haléře), branded as `Minor`.** All arithmetic,
parsing and formatting live in `apps/web/src/lib/domain/money.ts` and nowhere
else. 35 unit tests, including the magnitudes where a float division would round
wrong.

Two things worth knowing:

- `formatMoney` never divides the value it displays. It splits the integer into
  koruny and haléře and formats the koruny through `Intl`, so the displayed
  string is exact by construction rather than exact by luck.
- `mulRatio` (used for "required monthly contribution") computes in **BigInt**
  internally. That is a language primitive, not a decimal library, and it never
  escapes the function.

### Q0 — Name · answered 2026-08-23

**Výdaje.** Carries the spreadsheet's own name, so the habit transfers with it.
Set in `static/manifest.webmanifest`, `src/app.html`, the page titles and the
service-worker cache key. Domain still to pick — `vydaje.petrbohac.eu` fits the
plan's suggestion.

### Q7 — Excel history import · answered 2026-08-23

**Clean start.** Nothing imported. The 2026 workbook has no dates at all — only
which month sheet a row sits on — so any import would have had to invent them,
and inventing dates in a book whose entire point is "days covered" defeats the
book. The workbook stays as the reference it already is: it supplied the
categories and every check in the app.

Opening balance is set in Settings.

### Q23 — Groceries · answered 2026-08-23

**Split into POTRAVINY.** Three buckets where the workbook had a muddle:

|               |                                      |        |
| ------------- | ------------------------------------ | ------ |
| **POTRAVINY** | groceries, Rohlík, drogerie          | `need` |
| **JÍDLO**     | eating out — obědy, svačiny, kavárny | `want` |
| **BYDLENÍ**   | housing only                         | `need` |

This is the change with the most reach in the whole set. In the workbook,
`jídlo` was the most common description _inside BYDLENÍ_ — 27 rows plus 11
Rohlík deliveries — so neither the food figure nor the housing figure meant
anything, and 25 286 Kč of food was invisible.

The split also does real work for the Trimming law: eating out is the
discretionary half, which is why JÍDLO is a `want` while POTRAVINY is a `need`.
Mixed together they were unreadable; separated, one of them is actionable.

### Q25 — Shared payments · answered 2026-08-23

**Receivables, on the transaction.** You paid the whole thing, so the whole
thing is in the balance. An outstanding share sits on the expense as
`owedAmount` + `owedBy` and changes nothing until the money arrives; marking it
received creates the inflow that carries it and links the two.

Three consequences worth knowing:

- The balance never shows money you cannot spend.
- An inflow filed under a _spending_ bucket is treated as a refund and nets
  against that bucket instead of counting as income. Booking the 1 250 Kč gas
  refund as income — which the spreadsheet did every month — inflated income and
  spending simultaneously; that is now structurally impossible.
- "Dluží mi" on `/mesic` lists what is outstanding, with a one-tap _Přijato_.

Entered from the entry screen behind a `dluží mi` pill, so the five-second path
is untouched for the 95 % of entries that are nobody else's business.

---

## Assumed — the plan's own recommendation, applied without confirmation

| #   | Question          | Applied                                                                                                | Revisit when |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| Q1  | Scope of tracking | (a) personal only; `Account` and `Category` already model more                                         | Before P2    |
| Q2  | Currency          | CZK only; `currency` column present and unused on every account                                        | Before P2    |
| Q3  | Budgeting method  | (a) pure ledger in P1; `Category.monthlyCap` exists and is null                                        | Before P3    |
| Q8  | Receipt photos    | No                                                                                                     | Not in v1    |
| Q10 | Backend           | ASP.NET Core 9 Minimal API — not yet written                                                           | P2           |
| Q11 | Server database   | PostgreSQL 16 — not yet written                                                                        | P2           |
| Q13 | Sync approach     | Hand-rolled outbox + LWW; the `outbox` table and the `enqueue()` seam exist, `SYNC_ENABLED` is `false` | P2           |
| Q14 | Auth              | Device-bound JWT with pairing code                                                                     | P2           |
| Q17 | Frontend hosting  | Same origin as the API                                                                                 | P2           |

---

## Open

| #   | Question                                                                           | Blocks                               | Placeholder in the code                                                                                                              |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Q0  | Name and domain                                                                    | PWA manifest, JWT audience           | Working name **Výdaje** ("the tape"), in `static/manifest.webmanifest`, `src/app.html` and three `<title>` tags                      |
| Q4  | Real account list                                                                  | Whether transfers are a core flow    | One seeded account, `Běžný účet`, renameable in Settings                                                                             |
| Q5  | Active debt                                                                        | `Loan` entity for the Trimming law   | None                                                                                                                                 |
| Q6  | Bank import                                                                        | P4 shape                             | None                                                                                                                                 |
| Q18 | Repository host                                                                    | Where this is pushed                 | `git init`, no remote, no commits yet                                                                                                |
| Q19 | Timebox                                                                            | Whether the phase plan needs cutting | —                                                                                                                                    |
| Q29 | Does a broken cap get raised automatically after two months, or stay?              | Trimming T2                          | Recommendation: offer once, with the real average beside it                                                                          |
| Q30 | Is the health score dropped?                                                       | Training R4                          | Recommendation: **yes** — a compounded number is uninterpretable when it moves; keep coverage, want-share and caps-held separate     |
| Q31 | Must the monthly close's written sentence be mandatory?                            | Training R2                          | Recommendation: yes, like `Goal.why`                                                                                                 |
| Q32 | Nudge at 21:00 — right hour?                                                       | Training R3                          | Ask after the gate; the entry timestamps will answer it                                                                              |
| Q35 | Is `DARY` really "given away, nothing expected back", or are gifts something else? | The give class in the split          | Recommendation: yes for now. If gifts to family read differently to you, add a separate `CHARITA` bucket and put DARY back to `want` |

---

## Deviations from the plan

### Q21 — `Category.isIncome` · new, needs a ruling

**The plan's `Category` has no way to say "this one is income."** `SpendType` is
`need | want | save | debt`, all of which describe an outflow. That leaves a
salary with three bad options: no category at all (it sits in the uncategorised
queue forever, which is the one queue that must reach zero for the monthly close
to work), a `save` category (which then lies to the savings-rate calculation), or
a `need` category (which lies to the need/want split).

**Applied:** added `isIncome: boolean` to `Category`. The entry screen shows
income chips when the direction toggle is on `+` and expense chips when it is on
`−`. One income category is seeded, `PŘÍJEM`, matching the workbook's column A.

**Consequence for P2:** one extra boolean column on the server. Trivial now,
annoying later.

**Alternative if you dislike it:** derive direction from the sign of the
transactions that use the category. Cheaper in schema, worse in practice — it
guesses, and it guesses wrong on the first refund.

### The tape renders gap days, and that costs something

`buildTape` materialises every day between the oldest transaction and today so
gaps are visible as holes (§6, Tracking). With a long history that is a lot of
DOM. There is a `maxGapDays` cap, default 400. If the tape ever feels slow, that
is the knob — and the real fix is windowing, not removing the gaps.

### The entry screen loads every transaction for the account

`+page.svelte` reads the whole account history to compute the balance and to
order the category chips by recency. At a thousand rows this is free. At fifty
thousand it will not be. Revisit at P3, when the health score needs aggregates
anyway.

---

## The workbook

`Výdaje 2026.xlsx`, eight months, 547 entries, supplied 2026-08-23. It is the
best specification this project has, because it is a record of what actually
happens rather than what someone intends to happen.

### The structure, kept

One column pair per bucket — amount and `popis` — with the bucket totals across
the top, `CELKEM` (income − expenses) and `VÝDAJE` beside them, one sheet per
month and a `SUMA` sheet at the end.

That maps onto the app as: buckets become the category chips, `popis` becomes
the payee field, the monthly sheet becomes `/mesic`, and `SUMA` becomes the
month switcher. Seven expense chips fit on one screen without scrolling, which
is worth more to the five-second target than any richer taxonomy would be.

### What it got wrong, and what now catches it

| In the spreadsheet                                                                        | Cost                                                                                                 | The check                                                                                          |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Food filed under BYDLENÍ, LIFESTYLE, DARY and PROJEKTY                                    | JÍDLO reported 13 083 Kč; the real figure is at least 38 369 Kč                                      | `misfiled` — matches the description against the vocabulary and offers the right bucket in one tap |
| OSTATNÍ as a dumping ground: "opak. obj" 17 074 Kč, "objednávka" 6 291 Kč                 | 100 895 Kč, the second largest bucket, explaining nothing                                            | `other-overflow` and `vague`                                                                       |
| "Netflix - 379" recorded as 74 Kč; "objednávka (2415 Zůza)" as 5 008 Kč                   | Shares of joint payments, with no record of who owes the rest                                        | `unclear-number`                                                                                   |
| A 41 890 Kč front door in the same column as the groceries                                | KVĚTEN cost 106 308 Kč against a typical 65 000 Kč, and dragged the yearly average with it           | `one-off` plus a separate "běžný chod měsíce" figure                                               |
| "Zůza - bydlení plyn 1 250" booked as income while the full 2 500 Kč sat in BYDLENÍ       | Income and spending both inflated; the savings rate is meaningless                                   | `refund-as-income`                                                                                 |
| HBO Max entered as −18 Kč, twice                                                          | A refund hacked into an expense column                                                               | Direction toggle, so a refund is a refund                                                          |
| `SUMA` covered six months while the workbook held eight — B7 and B8 never got the formula | The average monthly cost was computed over 6/8 of the data, and two months in the red were invisible | Totals are computed from the rows, never dragged                                                   |
| `E2`, labelled "CELKEM ZA 12 MĚSÍCŮ", is `F5-E5`                                          | It is the average monthly surplus, −379 Kč, and it is negative                                       | `/mesic` states income, outflow and net separately, per month                                      |
| No dates anywhere — only which sheet a row is on                                          | No gaps, no streaks, no "when"                                                                       | Every transaction carries a date; gap days render as holes                                         |
| 102 descriptions with trailing spaces; twelve subscriptions retyped monthly               | Fragmented grouping; the −18 Kč error survived two months                                            | Trimmed on save, autocompleted from history, `duplicate` check                                     |

Four of the eight months ran a deficit: LEDEN −23 355, BŘEZEN −238,
KVĚTEN −45 937, ČERVENEC −10 048. The spreadsheet never said so on any screen he
looked at. `/mesic` does, per month, in the `CELKEM` figure.

---

## Deviations, continued

### Q22 — `Txn.isOneOff` · new, applied

A one-off is counted in the balance and excluded from "what a month costs".
Without it the front door and the mortgage sit in the same average as the
groceries, which is what made KVĚTEN look like a catastrophe and every other
month look cheap.

**Consequence for P2:** one boolean column.

### Q24 — SPOŘENÍ as its own bucket · applied, confirm

"Dlouhodobá investice", 2 000 Kč every month without fail, sat inside OSTATNÍ.
The one number the Targeting law is built on was buried in the dumping ground.
It is now its own bucket. Životní pojištění (1 008 Kč × 8) and double x
(1 478 Kč × 8) are still in OSTATNÍ and are the next two candidates.

### Q26 — `Goal.categoryId` · new, applied

**The plan's `Goal` has `linkedAccountId` and no way to say which bucket counts
as progress.** With one account that field measures nothing, and without _some_
link the only available progress figure is the account balance — which moves for
every reason under the sun and is therefore not progress towards anything.

**Applied:** `categoryId: string | null`. Non-null names the bucket;
`null` means every `save`-typed category counts. A new goal defaults to
`SPOŘENÍ` by name, falling back to the first `save` bucket
(`domain/goals.ts` → `defaultGoalCategory`) — INVESTICE DO MĚ is savings too, but
it is money spent _on_ yourself rather than money kept, and it sorts first, so
without the name check every new goal would have silently pointed at the wrong
bucket. It did, in testing, which is how this was found.

**Consequence:** progress is derived, never stored. A contribution is an ordinary
outflow into that bucket — there is no second set of books, and that is the whole
reason the number can be trusted.

**Consequence for P2:** one nullable text column.

### Q27 — `Goal.startDate` · new, applied

Without it, a goal written today opens already part-funded by whatever happened
to be in SPOŘENÍ beforehand — 16 000 Kč, in the workbook's case. "Money in the
savings bucket" and "money I have put aside _for this_" are different numbers and
the law needs the second one.

**Applied:** `startDate: IsoDate`, defaulted to the first of the month the goal
was written. Contributions before it do not count. Editable, so a goal can
deliberately claim an existing pot.

**Alternative rejected:** deriving the start from the UUIDv7 timestamp. It is
technically available and it is a trap — the id would silently become a
business-meaningful field, and a goal written on the 28th would start counting
three days before the month it belongs to.

### Q28 — `MonthTarget` as its own entity · new, applied

The question the Targeting law actually poses is not "what is the goal" but
"what is _this month_ aiming at", because a month is the only horizon anybody
acts on.

The app can always compute the number: remainder ÷ months left, rounded up. That
is arithmetic. **A target is a decision**, and the two must be distinguishable on
screen or the law is decoration. So the computed figure is shown as a proposal —
_"Spočítat se to dá vždycky — cílem se to stane, až to potvrdíš"_ — and
confirming it writes a row.

**Applied:** new table, schema **v2**, `monthTargets: 'id, month, goalId,
[goalId+month]'`. One row per goal per month, soft-deletable like everything
else; clearing one drops that month back to the proposal.

**Alternative rejected:** a map of month → amount inside `Goal`. Cheaper in
schema, wrong for sync — LWW would make two devices editing two different months
clobber each other, and the merge granularity has to match the edit granularity.

### Targeting shipped ahead of P3 · 2026-08-24

§11 put the Goals screen in P3, after sync. It was brought forward because it was
the only one of the four laws with **no mechanism at all** — the model existed,
the guard existed, and nothing in the app ever showed a goal or asked for one.
The other three laws each had something running on every keystroke.

The 14-day gate is unaffected: this adds one route and one 24 px strip to the
launch screen, and changes nothing about entry.

**Watch during the gate:** whether the strip is read or becomes wallpaper. If it
is wallpaper, the fix is that it should say less, not more.

### A race that only sometimes lied · found in verification

The entry screen's confirmation names what the goal still needs after a save. The
first implementation computed it _after_ `await createTxn`, subtracting the
amount from the derived remainder — on the assumption that Dexie's `liveQuery`
would not have flushed yet.

It had. The toast double-counted every contribution and was off by exactly the
amount just entered.

**Rule this establishes:** anything a message says about "before and after" must
be captured **before** the write. A derived value read after an `await` is a
coin-flip against the query layer, and a message that is right only when it wins
that race is a message that is sometimes wrong.

### Q33 — `SpendType` gains `give` · new, applied

**The book's first allocation has no home in `need | want | save | debt`.** Money
given away with nothing expected back is not a want; filed as one it disappears
into the discretionary pile, and the 10 / 10 / 10 / 70 split cannot report the
one number that law is about.

**Applied:** `SpendType = 'need' | 'want' | 'give' | 'save' | 'debt'`. Selectable
in Settings like the others.

**Data change, schema v3:** the seeded `DARY` bucket is re-filed from `want` to
`give`. Narrow on purpose — the migration touches a category only if it is still
exactly as seeded, name `DARY` and type `want`. A bucket already re-typed by hand
is a decision and is left alone, and changing it back is one dropdown.

**Consequence:** DARY leaves the "chtěné" side of the need/want split. That split
is a Trimming figure and giving is not discretionary spending in the book's
sense, so this is the intended reading rather than a side effect. Open as Q35.

**Consequence for P2:** one more enum value.

### Q34 — Shares are measured against income, not outflow · applied

A share of outflow always sums to 100 %, which means it can never say the one
thing worth knowing: whether more went out than came in. Measured against income,
the four classes plus what is left over are the whole picture, and overspending
shows as a negative remainder.

The consequence is that a month with **no income has no split**, and the app says
so rather than dividing by zero or quietly falling back to a share of outflow.
`domain/prosperity.ts` reads `summariseMonth`'s output rather than raw rows, so
the refund and income rules of §6.1 are applied once, in one place.

### The tape was clipping most of its own content · found 2026-08-24

`.tape` is a flex column and `.month` is therefore a flex item. `.month` carries
`overflow: hidden`, which exists only to clip the corner radius — but it also
drops the item's automatic minimum size to zero. A month asking for 1 843 px was
squashed into 422 and the remainder silently cut off, so the scroll container had
nothing left to scroll and the ledger showed a fraction of itself.

**Fixed with `flex: none` on `.month`.**

**Rule this establishes:** `overflow: hidden` on a flex item is never cosmetic.
Any card inside a scrolling flex column needs `flex: none`, or it is a candidate
for the same silent truncation.

### The `$store` auto-subscription did not reach the header · found 2026-08-24

On `/mesic` the month switcher lives in `<header>`. With `$txns` read through
Svelte's `$` auto-subscription, the header's bindings rendered against the empty
first tick of the live query and never updated — a probe printed `store=0` in the
header while `<main>` was drawing five buckets from the same query, in the same
component instance. The effect was that `‹` was stamped `disabled` on load and
**every earlier month was unreachable** until you navigated forward first.

Naming the deriveds did not help; neither did funnelling every read through a
single `$derived`. Subscribing to the `liveQuery` by hand and assigning into
`$state` did, because a `$state` write invalidates every reader unconditionally.

**Rule:** where a live query feeds anything outside the main scroll region,
subscribe explicitly rather than relying on `$store`. The auto-subscription is
fine where it already works; it is not to be trusted for new bindings without
checking them on a cold load.

### Auto-marking empty days · decided 2026-08-24

Asked for: empty days should read "day without expenses" without waiting for a
tap. Raised against it: a `DayMark` is the exact signal `coverage` uses to tell a
genuine zero from a day nobody looked, so filling them in wholesale takes
days-covered to 100 % permanently and retires the check that says "your totals
are lower than reality".

**Decided: mark forward only.** History keeps its honest holes. From now on the
app closes off exactly one date — the last day it was open — and only if nothing
was recorded on it.

The condition is deliberately "the app was open that day", not "the day passed".
Having the thing in your hand and putting nothing in it is evidence. A day you
never opened it is not a zero, it is a day you did not look, and it stays a hole.
`repo.ts` → `closePreviousDay`, called from the layout load.

### Still worth doing with receivables

Netflix, HBO Max and Prime are recorded as "my share" with the full price in the
description — `Netflix - 379` at 74 Kč. Those are now expressible properly: the
full 379 Kč as the expense, 305 Kč as owed. The `unclear-number` check points at
it, but nothing migrates the old habit automatically.

---

## Design pass · 2026-08-23

The plan's §8 palette was cool grey paper. Replaced, at Petr's request, with a
quiet blue and a floating treatment — the reference was the Svelte homepage: an
object sitting in soft light on a gradient ground, and nothing else competing
with it.

What changed, and what deliberately did not:

- **Blue, both themes.** Ground `#ECEFF7` → `#0A1120`, surfaces float above it.
  One accent (`--accent`) for the primary action and selected state, and nothing
  else. The semantic three — outflow, inflow, flag — keep their meaning in both
  themes.

  **Contrast was measured, not assumed.** The first pass failed: light amber sat
  at 3.2:1 and the tertiary ink at 4.0:1. `--flag` was deepened to `#8F5F05` and
  `--ink-3` to `#5F6A82` (light) / `#8290AC` (dark). Every ink/surface pair used
  for body text now clears AA on `--tape`, `--tape-2`, `--paper` and all three
  washes. `--paper-2` — the far end of the background gradient — is the one
  exception, and carries no small text: the rule is that text belongs on a slab.

- **Slabs, not sheets.** Surfaces get a hairline, a soft shadow and an 18px
  radius. The keypad and the Save button are one floating slab; the amount sits
  in a radial pool of light with nothing near it. That is the "object just
  sitting there" idea, done in CSS — no 3D asset, nothing to download.
- **App shell.** The window itself no longer scrolls: each screen is a fixed
  frame and long content scrolls inside it. This is what guarantees the keypad
  is never pushed below the fold, which the previous layout could do on a short
  phone.
- **The tape survives.** Dashed perforations, mono tabular money, right-aligned
  columns. The identity did not change, only the light it sits in.

### Money toasts

A saved transaction now shows the amount at 28px in the direction's colour, with
an arrow badge, the bucket and payee underneath, and undo. Saving 450 Kč of
groceries and saving a settings change no longer look the same.

### Entry screen, restructured

- The month's income / outflow / net moved to the top of the entry screen, so
  the standing question — "how am I doing" — is answered before anything is
  typed. The account-balance link it replaced is gone.
- Direction is a two-word segmented control (Výdaj / Příjem) instead of a `−`
  glyph nobody could read.
- Three chips — the **most used**, not the most recent — plus a search sheet for
  everything else. Picking from the sheet keeps that bucket on the row.
- `1×` became **jednorázový**, spelled out, next to **dluží mi**. Both are rare,
  so they sit below the payee line as ghost buttons rather than in the fast path.
