# TODO — what is left

**Revised:** 2026-08-27
**Audience:** Petr (decisions), Claude Code (implementation)

> The only file in `docs/` that carries a backlog. Everything else describes the
> app as it stands.
>
> **Finished work is not listed here.** It is described in `PROJECT-PLAN.md` and
> argued out in `DECISIONS.md`; repeating it in a third place is how this went
> stale the first time. If a thing is not on this page it is either built or
> deliberately rejected.

---

## State, 2026-08-27

| Check                      | Result                          |
| -------------------------- | ------------------------------- |
| `pnpm test`                | 333 pass, 18 files              |
| `pnpm check`               | 0 errors, 0 warnings, 406 files |
| `pnpm lint`                | passes                          |
| `pnpm budget`              | 84.1 kB of 150 kB brotli        |
| `dotnet test` (`apps/api`) | 32 pass                         |
| Schema · backup format     | **v6** · **5**                  |

P0, P1, P2 (sync) and P5 (reporting) ship, along with targeting, investments,
recurring payments, coverage and the streak, reconciliation, and draining
OSTATNÍ. **Everything left in P3 is blocked on a question below.** P4 has not
been started.

---

## 1. The gate

`PROJECT-PLAN.md` §11: **fourteen consecutive days of real use before any new
feature.** Nothing in §3 or §4 below starts until that is done, and defects and
deployment are the only exemptions.

This is the item most likely to be skipped and it is the one with the most
evidence behind it — the spreadsheet it replaced was abandoned, not outgrown.

---

## 2. Blocked on Petr

Nothing here can be built until it is answered. Recommendations are the
project's own.

| #   | Question                                                                  | Blocks     | Recommendation                                                                         |
| --- | ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Q29 | Does a broken cap get raised automatically after two months, or stay?     | T2 caps    | Offer once, with the real average beside it                                            |
| Q30 | Is the health score dropped for good?                                     | R4         | **Yes.** A compounded number is uninterpretable when it moves                          |
| Q31 | Must the monthly close's written sentence be mandatory?                   | R2 close   | Yes, like `Goal.why`. An unfinished close is a wish                                    |
| Q32 | Nudge at 21:00 — right hour?                                              | R3 nudge   | Ask after the gate; the entry timestamps will answer it                                |
| Q35 | Is `DARY` really "given away, nothing back", or are gifts something else? | The split  | Yes for now. If gifts to family read differently, add `CHARITA` and put DARY to `want` |
| Q5  | Is there active debt worth a `Loan` entity?                               | Trimming   | Ask again once the split has run for a month                                           |
| Q6  | Which bank, and does it export GPC?                                       | P4 shape   | —                                                                                      |
| Q19 | Is there a timebox, or does this run until it stops being used?           | Phase plan | —                                                                                      |

**Q29–Q32 block most of P3 between them.** Four answers unlock caps, the monthly
close and the nudge — which is the whole of the Training law.

---

## 3. Owed by hand, not by code

Three targets in `PROJECT-PLAN.md` §3 have never been measured, and nothing in
the repository can measure them. They need a phone and a stopwatch.

1. **Entry speed.** Phone locked, in your pocket. Start a stopwatch, take it
   out, open Výdaje from the home screen, record a real 249 Kč of groceries,
   stop on the confirmation. Three times; keep the worst. Target **5 seconds**.
   Every design decision in this app defers to that number and nobody has ever
   checked it.
2. **Cold start.** Force-close, wait, tap the icon, time it until the keypad
   answers. Target **1 second**, on the actual phone — not a desktop, not
   Lighthouse.
3. **Days covered.** Off `/mesic` at the end of the second month; the `coverage`
   check already computes it. Target **90 %**.

Over five seconds means the app has the spreadsheet's problem and the fix is
friction, not features. Comfortably under means the mandatory category cost less
than feared, which also closes a risk in §14.

---

## 4. Unbuilt

### 4.1 Deployment — the rest of P2

Sync works and was verified across two devices. What is left is running it for
real, and none of it is application code:

- **A run against actual Postgres.** Everything was verified against SQLite,
  which the server supports so it can run on a laptop. The EF model is
  identical, but `docker compose up` has never been done — there is no Docker on
  this machine.
- **The nightly `pg_dump` to the NAS** (§14). A host concern. Until it exists
  the JSON export in Settings is still the only backup that has been tested.
- **Serving the client from the same origin as the API**, which retires the
  dev-only CORS allowlist.
- **Somewhere to serve it from over HTTPS**, which is also what makes a real
  home-screen install possible — the service worker will not register over plain
  HTTP.

### 4.2 P3 — the Training law

The largest remaining piece of the product, and the one the book is most
explicit about. All of it is designed in `TRIMMING-AND-TRAINING.md`.

| Item                             | Blocked on                 |
| -------------------------------- | -------------------------- |
| **T2** category caps, end to end | **Q29**                    |
| **R2** monthly close ritual      | **Q31**                    |
| **R5** cap history               | T2, so Q29                 |
| **R3** nudge notification        | **Q32**, and a live server |

**There is nothing left in P3 that does not need you.** R1, reconciliation and
T4 were the three that did not, and all three shipped on 2026-08-27.

`Category.monthlyCap` is in the schema and `null` on every row: Trimming has
enforcement and a target shape but still no **cap**, which is the mechanism the
book is most explicit about. And R2 got substantially cheaper — four of its five
steps now only have to be called rather than built.

### 4.3 P4 — bank import

Not started, and blocked on Q6. GPC/ABO parser, duplicate detection on date ± 3
days + exact amount + fuzzy payee, review-before-apply. **Never auto-apply.**

### 4.4 Small, and genuinely optional

- **`Dát do JÍDLO` should be `Dát do JÍDLA`.** `do` takes the genitive and the
  bucket names are stored in the nominative. Categories are renameable so a
  declension engine is out of scope; the options are a genitive column on the
  seed with a nominative fallback, or rewording to a case the noun survives.

  The re-file sheet built for T4 took the second option — its button reads
  `→ POTRAVINY` rather than `Do POTRAVINY` — so there is now a working example
  of the reword in the app to compare against. The entry screen's `misfiled` fix
  is the one place left. It needs a preference, which is why it is still here.

- **The stale-value push notification** — blocked on R3, deliberately. Building a
  second push channel first would be building the thing R3 exists to prevent.
- **Recurring payments**, four things named "not now" and still not now:
  promotion to `auto` after three identical confirmed months, exact
  missing-payment detection, the T3 panel on `/mesic`, cadences other than
  monthly. Reasoning in `RECURRING.md` §6.

---

## 5. Watch during the fourteen days

Not tasks. Observations, each with a fix that only makes sense once the
observation has happened.

- **Does the goal strip get read, or become wallpaper?** If wallpaper, the fix is
  that it should say _less_, not more.
- **Does the mandatory category hurt entry speed?** One guaranteed tap per entry.
  The fallback is a default bucket, not a queue.
- **Does any check fire constantly?** A rule that fires every time is a wrong
  rule, and the fix is the rule, not the threshold.
- **Is the confirm strip for recurring payments used, or dismissed?** If every
  schedule is confirmed unchanged, the promotion rule earns itself.
- **Does a trend line ever say something you did not already know?** It is new
  and unproven. If every month reads "±20 % oproti obvyklým", the window is too
  short or the threshold too low.
- **Does the tape feel slow?** `buildTape` materialises every gap day, capped at
  `maxGapDays: 400`. The knob is the cap; the real fix is windowing.
