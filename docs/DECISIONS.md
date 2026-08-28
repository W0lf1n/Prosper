# Decisions

One entry per question from PROJECT-PLAN §2, plus anything the plan turned out to
get wrong. Required by §13.14.

Laws 3 and 4 have their own design document, `TRIMMING-AND-TRAINING.md`.

Status: **answered** — decided, implemented. **assumed** — the plan's own
recommendation applied without confirmation; cheap to revisit.

> **Questions still open live in `TODO.md` §5, not here.** This file is the
> record of what was decided; duplicating the open list in two places is how it
> went stale the first time.

---

## Answered

### Q9 — Frontend framework · answered 2026-08-23

**SvelteKit 2 + TypeScript (strict).** Confirmed by Petr against the React
alternative.

Bundle budget was the deciding factor and it held: the entry route ships
**83.2 kB of JavaScript brotli-compressed** as of 2026-08-27 — checks engine,
goals, holdings, schedules, trends and the sync layer included — against a
150 kB budget, now enforced by `pnpm budget` rather than remembered. React + Vite
would have spent roughly that much before any application code.

Actual versions: SvelteKit 2.63, Svelte 5.56 (runes mode forced), Vite 8, TS 6.

### Q20 — UI language · answered 2026-08-23

**Czech only.** Code, identifiers, comments and this document stay English.
All money and dates go through `Intl` with the `cs-CZ` locale — never
hand-rolled (PROJECT-PLAN §13.11).

### Q16 — Phone platform · answered 2026-08-23

**Android primary, iOS kept working as a degraded case.** So the P3 nudge can
use Web Push (VAPID) without an iOS-shaped compromise. Nothing in P1 depends on
it.

### Q12 — Client storage · answered 2026-08-23

**Dexie 4.4.5.** The schema lives in `apps/web/src/lib/db/schema.ts` behind a
`migrations` array — a schema change is a new entry in that array, never an edit
to an existing one, because a released version is already on the phone. It has
moved v1 → **v6** since: monthTargets (Q28), the `give` re-file (Q33), holdings
and valuations (Q36), schedules (Q40), `Holding.startDate` (contributions).

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

### Q0 — Name · answered 2026-08-23, **renamed 2026-08-27**

**Prosper.** It was `Výdaje` for the first four days, on the reasoning that
carrying the spreadsheet's own name carried the habit with it. That reasoning
held while the app only recorded expenses. It stopped holding once goals,
investments, the 10/10/10/70 split and the record of months shipped: a ledger
named after outflow describes a quarter of what is on screen, and three of the
four laws are not about spending at all.

`Prosper` is the book's word, it was already the repository name, and it removes
the split identity between the two.

Set in `static/manifest.webmanifest`, `src/app.html`, the six page titles, the
service-worker cache key, the export filenames and the `@prosper/contracts`
package. **Two things were deliberately not renamed:**

- **The IndexedDB database is still `finance`.** Renaming it does not migrate
  anything — it opens a second, empty database and leaves the ledger stranded in
  the first, which is the one failure this project cannot recover from. The name
  is internal and nobody ever sees it.
- **`Výdaje 2026.xlsx`** is a real file on Petr's disk and the source for every
  check. It keeps its name.

The Czech word _výdaje_ stays everywhere it means "expenses" rather than the
app — the toggle on the entry screen, the empty state on `/mesic`, the workbook
column header. It is the common noun, not the title.

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

| #   | Question          | Applied                                                                                                                          | Revisit when |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Q1  | Scope of tracking | (a) personal only; `Account` and `Category` already model more                                                                   | Before P2    |
| Q2  | Currency          | CZK only; `currency` column present and unused on every account                                                                  | Before P2    |
| Q3  | Budgeting method  | (a) pure ledger in P1; `Category.monthlyCap` exists and is null                                                                  | Before P3    |
| Q8  | Receipt photos    | No                                                                                                                               | Not in v1    |
| Q10 | Backend           | ASP.NET Core 9 Minimal API — **written**, `apps/api`                                                                             | done         |
| Q11 | Server database   | PostgreSQL 16 — **written**; SQLite supported so it runs without Docker                                                          | done         |
| Q13 | Sync approach     | Hand-rolled outbox + LWW — **built**, see Q41                                                                                    | done         |
| Q14 | Auth              | Device-bound bearer token with a pairing code. **Not a JWT** — nothing needs to be stateless, and a hash in a table is revocable | done         |
| Q17 | Frontend hosting  | Same origin as the API. A CORS allowlist exists for dev only, off by default                                                     | Deploy       |

---

## Answered, continued

### Q18 — Repository and licence · answered 2026-08-27

**`github.com/W0lf1n/Prosper`, public, MIT.**

The repository was private with a remote set and two commits. Going public is a
decision about the documents as much as the code: `PROJECT-PLAN.md` and this file
address one reader by name and treat his spreadsheet as shared context, which is
what makes them useful and also what makes them odd for a stranger. `README.md`
carries the outside-facing version; nothing else changes to suit an audience.

**MIT** rather than AGPL: the thing worth reading here is the reasoning, not the
implementation, and a copyleft that reaches hosted forks defends against a
scenario that does not exist for a single-user offline app.

Three things had to be true before it could go public, and are tracked in
`TODO.md` §2: the licence file, `.idea/` untracked, and a lint run that passes
for somebody who has never opened the design tooling.

### Q4 — Real account list · answered by default

One seeded account, `Běžný účet`, renameable in Settings. `Account` and the
transfer model exist for more; nothing has needed them. Revisit before P2 —
transfers only become a core flow when there is a second account.

### Q0 — Domain · still unpicked, and now it blocks something

The name is settled (**Prosper**). The domain is not — and as of 2026-08-27 it
is no longer free to leave open. `DEPLOYMENT.md` needs one for three things at
once: the TLS certificate, the origin the PWA installs from, and the sync
address a device types when pairing. All three are the same host, because the
client is served from the API's own origin.

`prosper.petrbohac.eu` fits and `prosper.example.com` is what the runbook uses
as its placeholder. Nothing in the repository hard-codes a domain: it is typed
once, into the host's nginx vhost, by the one `sed` in `DEPLOYMENT.md` step 4.
The containers never learn it — the client asks the browser what origin it was
served from.

---

## Deviations from the plan

### Q21 — `Category.isIncome` · applied, shipped

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

### Q36 — Investments and a net-worth figure · new, applied

**This reverses a v1 non-goal.** `PROJECT-PLAN.md` §3 lists "Investment portfolio
tracking, net worth" as out of scope, and §3 is binding, so the reversal is
recorded here rather than assumed.

**What was actually rejected, and stays rejected:** portfolio tracking — tickers,
units, cost basis, prices fetched from anywhere. None of that is built and none
of it is planned.

**What is applied:** a holding is a name, a kind, and a number typed in by hand
off a statement, with the day that number was true. `/jmeni` adds them to the
ledger balance and calls the result `celkem`.

The case for it: the Targeting law already runs on a figure the app could not
see. SPOŘENÍ and INVESTICE DO MĚ take money out of the ledger every month, and
the ledger loses sight of it the moment it leaves — the app could say what was
set aside and never what it grew into.

**Data change, schema v4:** two new tables, `holdings` and `valuations`. New
tables only, so no upgrade function and no existing row is touched.

**The invariant this rests on:** a valuation is not a transaction. It never
reaches `income`, `outflow`, `net`, a `BucketTotal`, or `prosperitySplit`.
Unrealised growth is not income — if it ever were, a month where the pension
moved up 8 000 Kč would report a healthy savings share out of money nobody
earned, and the 10/10/10/70 split would become fiction. `summariseMonth` does
not take holdings as an input, and `holdings.test.ts` asserts both functions are
byte-identical with a full set of holdings in the database.

**Consequence for P2:** two more entity types, two more tables in the backup.
Backup `version` moves to 3; an older backup simply has no holdings.

### Q37 — Two holdings on one category · answered 2026-08-25

Contributions to a holding would be read off the ledger, the way goal progress
is. If two live holdings point at the same bucket, the outflows cannot be
attributed between them.

**Answer: show nothing.** An evenly split figure is wrong in a way nobody would
ever catch, and a number you cannot check is worse than a blank. The app says
why instead.

Not yet in force: contributions and growth are a later step, and `categoryId` is
carried on `Holding` from the first version so adding them is not a migration.

### Q38 — What may be a holding · answered 2026-08-25

**Liquid and semi-liquid only:** `investment`, `savings`, `cash`, `crypto`.

A flat at 6 800 000 Kč makes `celkem` a number that is true and useless — every
other figure on the screen disappears next to it, and none of it can be spent
this month. If property is ever tracked it needs a line of its own rather than a
place in the same sum. `HoldingKind` has room; the screen does not.

### Q39 — Debt in the total · answered 2026-08-25

**Not in v1.** `celkem` is a pure assets total. `AccountKind` already carries
`loan` and `credit`, and a mortgage balance is the same shape as a holding with
the sign turned round — stated from outside, stale by default — but netting it
off is a second feature and `Wealth` is shaped to hold it when it arrives.

### Q40 — Recurring payments, and whether they post themselves · answered 2026-08-25

Twelve subscriptions were retyped by hand every month in the workbook, and a
mortgage is the same act with a bigger number. The app could already _detect_
repetition (`missing-recurring`), which is statistical by construction; this
lets a payment be **declared** instead — what is owed, to whom, out of which
bucket, on which day.

**The tension, stated plainly:** auto-posting cuts against the Tracking law.
Money that lands in the ledger without anyone looking at it is the state the
spreadsheet left him in. Against that: retyping a fixed mortgage monthly is not
awareness, it is data entry — the decision was made once, years ago.

**Answer: both, per schedule, default `confirm`.** `confirm` offers the row on
the due day and a tap accepts it, amount editable first. `auto` writes it on the
next launch. The mortgage is `auto`; everything else starts at `confirm`.

**Data change, schema v5:** a `schedules` table, and `Txn.scheduleId` — null for
everything typed by hand. The migration restates `txns` in full because Dexie
replaces a table's whole index declaration, and it backfills `scheduleId: null`
rather than leaving the field absent: an index over `undefined` works, but
`row.scheduleId === null` would answer false for the entire existing ledger.

**Three consequences worth recording:**

- **`lastPostedMonth` is a watermark, not a derivation.** Posting is therefore
  idempotent, deleting a posted row does not resurrect it on the next launch,
  and "we skipped July" is expressible at all — none of which a ledger-derived
  version could do.
- **The confirmation strip offers one instance per schedule, oldest first.** The
  watermark is a high-water mark, so confirming August before May would mark May
  settled without ever showing it. This is correctness, not simplification.
- **An amount override never rewrites the schedule.** The gas bill is 2 800 Kč
  most months and 4 100 Kč in February.

**Not built, deliberately:** promotion to `auto` after three identical confirmed
months (`scheduleId` is carried so it needs no migration), and any cadence other
than monthly — every payment in the workbook is monthly.

**Consequence for P2:** one more entity type, one more table in the backup, and
one more field on every `Txn`. Backup `version` moves to 4.

Full design in `docs/RECURRING.md`.

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

## Design pass · 2026-08-23 — _superseded, see the graphite pass below_

> The palette described in this section no longer exists. It is kept because the
> second pass was an argument with it, and the argument does not read without it.
> The live system is `tokens.css` and the entry below.

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

---

## Design pass · graphite instrument — replaces the blue · _superseded in part, see the second edition below_

The quiet blue was replaced wholesale. The reference is no longer a homepage; it
is a **machined instrument**: a graphite ground, surfaces raised by _luminance_
rather than by boxes, hairlines only where an edge is load-bearing, and exactly
one signal colour.

**Dark first, and that is the actual argument.** The blue pass built a light
theme and derived a dark one. This app is used one-handed, in bed, with the
lights off — so graphite is the theme it is designed for and daylight is the
counterpart. Both are still declared twice, once under `prefers-color-scheme` and
once under `[data-theme]`, so the toggle wins in both directions.

**Outflow lost its colour, and that is the change with the most reach.** The blue
palette gave outflow a muted brick and inflow a teal. But most rows in a ledger
are outflow, so the tape rendered as forty red numbers — which is noise, not
information. Outflow is now the ink, `--signal` mint is the primary action and
money coming in, and the asymmetry is the point: an expense is the normal case
and does not need colour to announce itself.

The one place the rule is deliberately suspended is the ambient pool behind the
entry amount. There is exactly one number on that screen and the whole question
is which way it points, so the light behind it answers before the sign is read.
It stays a wash — seven per cent, tinting the ground rather than colouring the
digits.

**Elevation inverts between themes**, which is why `--raised` exists. In daylight
a raised slab is lighter than what it sits on; on graphite it is also lighter,
but the graphite scale runs the other way. A control that hard-codes `--surface`
or `--surface-3` is raised in one theme and sunk in the other.

**An explicit theme choice must move `color-scheme` with it.** Left at
`light dark`, the browser keeps rendering its own surfaces — form controls,
scrollbars, the canvas behind the page, the date picker — from the _system_
preference, so choosing light on a phone in dark mode produced a light page
wearing dark native controls.

**The old token names are kept as aliases** (`--paper`, `--tape`, `--accent`…),
mapping onto the new system, so a rule missed in the redesign degrades to
something coherent instead of to an unstyled box.

### Entry screen, restructured again

- Direction became **the coin**: a disc beside the amount carrying an arrow,
  tapped to flip. It replaced the segmented Výdaj / Příjem control, which had
  replaced a `−` glyph nobody could read. The control is now beside the thing it
  describes rather than above it, and the ambient hue says the same thing twice.
- The header slab gained a third icon — `/jmeni` — between the tape and the
  settings gear. That is the whole footprint investments were allowed on the
  launch route.

### A bottom tab bar was added

The blue pass had every screen reached from the entry header. Four destinations
now sit in a bar in the thumb zone — `/tape`, `/mesic`, `/cil`, `/settings` —
with a record disc between them that returns to entry.

Two things about it are deliberate:

- **The entry screen does not carry the bar.** The keypad owns the bottom of the
  phone and needs every pixel on a short screen. The centre disc is how you get
  back, which makes recording one tap away from anywhere.
- **`/jmeni` is not a tab.** It is the screen you open once a month, and a tab
  bar that holds everything holds nothing.

The bar is a flex child of the app column rather than a fixed overlay, so it
cannot cover a row and no screen has to reserve padding for it. The toast reads
`.app:has(.tabbar)` and lifts itself clear — a confirmation parked on top of the
navigation is a confirmation you have to wait out before you can leave.

---

## Deviations, continued — the sync layer

### Q41 — The server stores rows as JSON, not as ten typed tables · applied 2026-08-27

**`PROJECT-PLAN.md` §6 says client and server mirror each other, C# for TS.**
They do not. The server has one `changes` table: entity, id, `updatedAt`,
`deviceId`, `isDeleted`, and the client's row verbatim as JSON.

**The reason is the cursor.** §10.2 requires a server-assigned monotonic
sequence across _every_ entity, because a pull is "everything past this number"
and there is only one number. Ten typed tables cannot produce one without a log
table beside them — and once that log exists, having it also be the storage is
one moving part rather than eleven.

**What it costs:** the server cannot validate a category or notice a malformed
amount. It was never going to. The server is durable storage and a merge point
(§5); every rule about what a transaction _means_ lives in `domain/`, on the
client, where it is tested. A server that re-implemented those rules would be a
second place for them to be wrong.

**What it buys, beyond the cursor:** a schema change on the client is not a
server deployment. Schema v6 added `Holding.startDate`; the server needed
nothing.

**Alternative rejected:** typed tables plus a separate `changes` log. It is the
textbook shape and it stores everything twice, which for a single-user ledger
buys validation nobody asked for at the price of a consistency problem between
the two copies.

### Q42 — A device joining an existing ledger gives up its seed · applied 2026-08-27

**Found by the §11 acceptance test, not by reading.** Every device seeds itself
on first launch — one account, the starter categories — because until it is
paired it is the only device there is. Pair two and the ledger has two accounts
and two of every bucket, and each device shows an **empty tape while holding the
other device's rows**: they belong to an account it is not looking at.

**Applied:** `repo.ts` → `adoptRemoteLedger`. A device soft-deletes an account
it created and never wrote into, adopts the older one (UUIDv7 is time-sortable,
so the smallest id is the one that existed first), and drops its unused
duplicate buckets by name.

**The guard is authorship, not emptiness**, and the first version got this
wrong. By the time this runs the pull has already landed the _other_ device's
rows, so "is the database empty" answers no on a device that has done nothing.
The question is narrower: does an account **this device created** still have no
transactions of its own?

**It runs after every pull, not only at pairing.** Pairing two devices in quick
succession is a race the protocol cannot order — the first has only _queued_ its
seed when the second pairs, so the second pulls an empty ledger and sees no
reason to stand down. Deciding it on every pull makes the timing irrelevant.

**A device that has recorded something keeps its account**, and two accounts
then stand. That is a genuine question for a human rather than something to
guess at.

### Q43 — Reporting shipped without a dependency · applied 2026-08-27

§11 P5 says "XLSX export via ClosedXML", which is a server-side library, and
there was no server when the reporting work started. The client-side option is
SheetJS, which is several times the size of this entire application against a
150 kB budget (rule 12).

**Applied:** `domain/xlsx.ts`, hand-rolled. An .xlsx is a ZIP of five small XML
files, and the parts this needs fit in one module with tests. The ZIP is
**stored rather than deflated** — `CompressionStream` would shrink it, but it is
async and not on every engine, and stored entries make the writer a pure
function that can be tested. The file is a few hundred kilobytes either way.

**Money never becomes a float on the way out.** A cell value is assembled from
the integer's own digits, the same reason `formatMoney` splits rather than
divides, so a column of amounts sums in Excel to the figure the app shows.

**The export is one-way, deliberately.** A spreadsheet edited by hand and
imported back is precisely the loop this app was written to end.

### A trend against months that never existed · found 2026-08-27

`categoryTrends` averaged the earlier months of its window to say what a bucket
usually costs. With two months of real data and a six-month window, four of
those months were before the ledger began — and they counted as zeroes. Every
bucket in month two read as a catastrophe: POTRAVINY showed **+1594 %** against
a "typical" of 381 Kč, which was one real month divided by five imaginary ones.

**Rule this establishes:** a month before the first transaction is not a month
you spent nothing in, it is a month that does not exist. This is the same
distinction the tape already makes between a gap day and an explicit `DayMark`,
one level up. A genuine zero month _inside_ the ledger still counts — spending
nothing on JÍDLO in June is a fact.

---

## Deployment · 2026-08-27

### Q44 — nginx, not Caddy · applied 2026-08-27

**`PROJECT-PLAN.md` §5 drew Caddy in front of the API.** It is now nginx, twice:
once inside the `web` container and once on the host.

Caddy's argument was automatic TLS in one line. That argument is worth less than
it looks on a box that already runs nginx for other things — which this one
does — because the cost of Caddy is then a second web server, a second config
language and a second place a redirect can be written. certbot's nginx plugin
edits a vhost in place and installs its own renewal timer; it is three commands
once and nothing afterwards.

Nothing about the app depends on the choice. The host's reverse proxy is four
lines of `proxy_pass` and knows nothing about Prosper.

### Q45 — The client is served by its own container, from the API's origin · applied 2026-08-27

**§4 said "same origin as the API from P2" and nothing implemented it.** The
client was a `build/` directory somebody was going to put somewhere.

**Applied:** `apps/web/Dockerfile` — a pnpm build, then nginx with the static
output and one `location /api/` proxying to the API container. The API's port is
no longer published at all; the only way to reach it is through that location.

**What it buys is not tidiness, it is three specific things:**

1. **CORS is retired.** `Cors:Origins` stays unset in production. It exists so
   the Vite dev server on another port can be developed against, and a sync
   endpoint any page can call is a sync endpoint any page can drain.
2. **The pairing address is prefilled.** Settings offers `location.origin`,
   which is correct every time in this deployment, and the alternative was
   typing a domain on a phone keyboard.
3. **One published port**, bound to `127.0.0.1`. Postgres and the API are not
   on a public interface, so a firewall rule that is missing cannot expose them.

**Alternative rejected:** serving the static build from the host's nginx
directly and proxying only `/api/`. Fewer containers, and it puts a build
artefact on the host that has to be copied there and kept in step by hand. The
whole point of the image is that `docker compose up -d --build` is the only
thing anybody has to remember.

### The nginx trap that cost this its first 502 · recorded before it happened

**nginx resolves a literal hostname in `proxy_pass` once, when it loads its
config, and holds that address until it is reloaded.** `proxy_pass
http://api:8080` therefore works perfectly until the API container is rebuilt
with a new IP — after which every sync cycle 502s, `docker compose ps` says all
three containers are healthy, and the API's own logs are silent because nothing
is reaching it.

`app.conf` goes through a variable and Docker's embedded resolver
(`127.0.0.11`), which forces a lookup per request. `$request_uri` is then
mandatory: a `proxy_pass` with a variable in it passes no URI of its own.

This is recorded because the symptom points everywhere except at the cause.

### Brotli twins are built and not served · accepted 2026-08-27

`precompress: true` emits `.br` and `.gz` beside every asset. Stock nginx has no
brotli module, so the container serves the `.gz` with `gzip_static` and the
`.br` files sit in the image unused.

The budget is measured in brotli and the entry route is 84.2 kB of it. Gzip
costs perhaps a fifth more on the wire, once, on a cold load of an app that then
runs from a service worker cache. Maintaining a custom nginx build to recover
that would be a dependency (rule 12) with a compile step attached, for bytes
nobody waits on twice.

### `add_header` does not merge down · recorded 2026-08-27

A `location` block that declares any `add_header` of its own **replaces** every
one inherited from the server block rather than adding to it. The two locations
that set a long `Cache-Control` would have silently dropped the three security
headers — and a missing security header looks exactly like a present one.

`deploy/nginx/headers.conf` is included in every block that sets a header of its
own. It is the fix that stays fixed when somebody adds a fourth location.

### The sync database has no migrations, and creates itself · recorded 2026-08-27

Asked directly — "what is needed to create the sync database on the server" —
the answer turned out to be "nothing", and that was not written down anywhere.

`Program.cs` calls `EnsureCreatedAsync()` on startup behind
`Database:MigrateOnStart` (default true). There is no `Migrations/` folder in
the repository and no `dotnet ef database update` step in any runbook, on a
server or a laptop. Postgres creates the role and the database from the compose
environment on the first start of an empty `pgdata` volume; the API then finds
no tables and creates `changes`, `devices` and `sync_state`.

**The latent trap: `EnsureCreated` creates a schema and never alters one.** A
new column on the server model would leave an existing database silently on the
old schema, failing on the first query that names it — with no migration error,
because nothing attempted a migration.

It is still the right call today, and the reason is the same one that makes the
server simple: it stores the client's row as JSON and reasons about four fields,
so a **client** schema change is not a server concern at all. The server model
has not moved since it was written. If it ever does, that is the moment to add
EF migrations and switch to `MigrateAsync()` — a migration history for a schema
that has never changed is ceremony.

Written up in `docs/DEPLOYMENT.md` § The sync database, with the schema, the
inspection commands, the reset and the restore.

### Table names are lowercase, column names are not · recorded 2026-08-27

`AppDbContext` sets table names explicitly with `ToTable("changes")`, so those
are lowercase. It does not set column names, so EF takes them from the property
names and they are PascalCase: `"Entity"`, `"EntityId"`, `"UpdatedAt"`,
`"DeviceId"`, `"IsDeleted"`, `"Payload"`, `"Seq"`.

Postgres folds an unquoted identifier to lowercase, so the obvious query fails:

```sql
select entity, count(*) from changes group by entity;   -- column "entity" does not exist
```

The error names a column that is visibly right there in `\d changes`, which is
what makes it cost more time than it should. Quote them.

This is recorded rather than fixed. Renaming the columns to snake_case would be
a schema change, and a schema change is exactly what this deployment has no
migration path for — so the cost of tidiness here is the one operation the
database cannot currently do.

### The runbook generated a pairing code the phone cannot type · fixed 2026-08-28

`DEPLOYMENT.md` step 2 and `deploy/.env.example` both said `openssl rand -hex 4`
for `PAIRING_CODE`, which produces something like `a3f9b21c`. The pairing input
in `routes/settings/+page.svelte` is `inputmode="numeric"`, so the phone offers
a digit pad and the letters cannot be typed on the one device that has to type
them. `.env.example` said "six digits is what the UI expects" two lines above
the hex command, which is how it survived review.

Both now say
`shuf --random-source=/dev/urandom -i 100000000000-999999999999 -n 1`.

The server was never wrong: `DeviceAuth.CodeMatches` compares strings and does
not care. **The keyboard is the constraint, not the protocol** — which is why
the fix is in the two files that generate the value, and no validation was
added. A code the server refuses is worse than a code that is long.

### Twelve digits, and two limiters that were not counting what they said · fixed 2026-08-28

`Program.cs` sized the pairing code against its own rate limiter: six digits is
a million guesses, five attempts a minute per address turns that into months.
The arithmetic was right and both of its premises were wrong, because neither
fence was counting per address.

**The API's limiter partitioned on a value the caller controls.** The key was
`X-Forwarded-For`'s first hop. Both nginx layers set that header with
`$proxy_add_x_forwarded_for`, which *appends* the real peer rather than
replacing the list — so a request arriving with `X-Forwarded-For: 9.9.9.9`
reached the API as `9.9.9.9, …` and `Split(',')[0]` handed back the caller's
own string. A fresh value per request was a fresh bucket per request.

**The container's `limit_req` was one bucket for the world.** It keys on
`$binary_remote_addr`, and inside the container that is the host's nginx on
every request. The comment said "per client address"; it was a global cap of one
guess a second, which is a *stronger* brute-force fence than intended and a
denial-of-service lever besides — a stranger hammering the endpoint could keep
the real phone from pairing.

### The fix, and why it is one line of nginx

`deploy/nginx/app.conf` now runs `real_ip` in the server block, so
`$remote_addr` inside the container becomes the address the host's nginx
accepted a connection from. That single change fixes both: `limit_req` starts
bucketing per client, and `X-Real-IP` — which both layers overwrite with their
own peer — becomes a value the caller cannot write.

**`real_ip_recursive` is off, and that is the security property rather than a
default nobody touched.** Off means nginx takes the *last* entry in
`X-Forwarded-For`, which is the one the host's nginx appended and therefore the
only one in the list that was observed rather than claimed. On would walk
leftward through exactly the attacker-supplied part.

The API stopped reading `X-Forwarded-For` at all. `Sync/ClientAddress.cs` takes
`X-Real-IP`, and honours it **only from a peer in a private range** — loopback,
the three RFC 1918 blocks, `fc00::/7`, and IPv4-mapped v6 because Kestrel
reports the compose network as `::ffff:172.18.0.1`. If this server is ever
reachable directly, a stranger sending `X-Real-IP` still does not get to pick
its own bucket, and a compose file that stops saying `expose` is one word away.
Eighteen tests, because the previous version of this logic looked correct too.

### What twelve digits is worth once the fences are honest

Per-address fences scale with addresses, which is the trade for fixing them: a
botnet gets its 5/min per member. That is what makes the length the load-bearing
part rather than the limiter.

Against ten thousand addresses each drawing its full allowance, **six digits
falls in twenty minutes**. Twelve digits — 9 × 10¹¹ codes, the range starting at
`100000000000` so a leading zero can never make it eleven — takes thirty-four
years, and three hundred and forty thousand from one address.

The code is generated by `DEPLOYMENT.md` and `.env.example`, not validated by
the server: `CodeMatches` compares whatever string it is given. A code the
server refuses is worse than a code that is long.

One caveat worth writing down: **a CDN in front of the host's nginx would undo
this.** The host would then see the CDN's edge as its peer and append *that*,
and the container would faithfully bucket per edge. Nothing here needs a CDN,
and if one ever appears the host's nginx needs its own `real_ip` block first.

## Design pass · graphite instrument, second edition · 2026-08-27

Same instrument, calmer machining. Delivered as a handoff bundle
(`docs/design_handoff_prosper_visual_refresh/`) of a wholesale `tokens.css`
replacement plus four patch files. Flow, routing, component structure, state and
logic were not touched: every change is a token value or a rule inside an
existing `<style>` block.

**Every token name is frozen; only values moved.** That is what made the pass
safe to apply at all — roughly 11 000 lines of CSS reference these names, so a
rename would have been a rewrite. `--elev-1` was retired to a valid no-op
(`0 0 0 0 rgb(0 0 0 / 0%)`) rather than deleted, so the existing
`var(--edge), var(--elev-1)` comma lists kept parsing while the rules that used
them were simplified one at a time.

### The four laws of the refresh

**1. Elevation is luminance, not shadow.** A card is raised because it is
lighter than the ground. Real shadow survives only where a layer genuinely
floats over content: `Sheet` (`--elev-sheet`), `Toaster` (`--elev-3`), and the
≥35rem centred sheet. The keypad shell, the tab bar, every card and every key
gave theirs up.

**2. Recession is a pocket.** No `inset` shadows anywhere in the app. Inside a
card, recessed is `--ground-2` and raised is `--raised`, and it steps the right
way in both themes — dark `#0c0c0e → #2a2a2c`, light `#e8e8ec → #ffffff`.

The pocket is explicitly a law about the inside of a card. `.prop__track` on `/`
was left at `--surface-3` for exactly that reason: the context panel has no card
under it, it sits on the page ground, and on a true-black ground a `--ground-2`
toggle track is invisible. A well needs something above it to be sunk into.

**3. One press, one number.** `transform: scale(0.95)` over `--dur-press`, and
nothing else moves. The keypad key used to run four properties at once — face
translate, highlight, shadow collapse, surface darken — which was two presses
fighting over 90 ms. The exception is a full-bleed list row (`.row`, `.blank`),
which presses by background luminance: scaling a 100 %-wide row by 5 % shows the
ground through its own corners.

**4. Pill is reserved for the primary action.** `--radius-full` on a button now
means "this is the action" and nothing else is allowed to be one. Two buttons of
equal size are told apart by shape rather than by a second colour — which is why
`Odložit` is a pill on `/cil` and `Upravit cíl měsíce` beside it stays
`--radius-md`.

### Signal and inflow became two roles

The graphite pass had one mint doing duty as both the chrome accent and money
coming in. They are now separate hues: `--signal` is blue and is chrome only
(links, primary buttons, focus ring, current selection, the record disc),
`--in` stays mint and is money. Outflow keeps its ruling from the first pass —
it has no hue, it is the ink — and the ambient pool behind the entry amount
remains the one deliberate suspension of that rule.

### Instrument Sans was removed, and the budget paid for the pass

The label stack is now `system-ui, -apple-system, BlinkMacSystemFont, …`, which
resolves to real SF Pro on Apple hardware and costs zero bytes. Nothing
referenced Instrument Sans afterwards, so both `@font-face` blocks and both
woff2 files went with it. IBM Plex Mono is now the only face the app ships, and
it ships for one reason: money.

The service worker needed no edit — it precaches from `$service-worker`'s
generated `files` list, so deleting from `static/` removes them from the cache
manifest on its own.

Entry route after the pass: **84.2 kB brotli against the 150 kB budget.**

### `.card` and `.meter` became single definitions · 2026-08-27

Not part of the handoff, done alongside it. `.card` was three byte-identical
copies in `/mesic`, `/cil` and `/settings` differing only by `gap`, and `.meter`
was two copies in `/mesic` and `/cil` that had **already drifted** — 6 px versus
8 px for `--thick`, and different default fills — while both files carried a
comment calling it "the shared meter".

Both now live once in `app.css`. `.slab` and `.card` share one surface rule,
since a card is a slab as a padded column. No markup changed: the routes already
spell the classes this way, and a Svelte scoped rule
(`.card.svelte-xxx`, specificity 0-2-0) still beats the global one, so a screen
that wants a tighter gap or a signal fill declares only that difference.

This is the reason it was worth doing during a visual pass rather than after
one: the drift above is what happens when "the shared meter" lives in two files,
and the refresh would have had to change the track colour in both.

### Two literals that are not colours

The `grep` that must return nothing — a hex outside `tokens.css` — has one
honest false positive and it was rewritten rather than exempted.
`CategoryPicker`'s fade uses a `mask-image` whose stops are read for their alpha
channel only; `#000` there means "fully opaque", not black. It is now the
`black` keyword with a comment saying so.

`app.html`'s two `theme-color` meta tags and the manifest's `background_color`
genuinely cannot take a custom property, so they carry the ground as a literal
and were retuned by hand to `#F5F5F7` / `#000000`. They are the only place in
the app where a colour is written twice, and they are the first thing to check
if the PWA's status bar ever stops matching the page.
