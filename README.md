# Výdaje

Offline-first personal finance tracker. Records a transaction in under five
seconds, one hand, no network — and then checks the entry before it is saved.

## Why it has opinions

It is built on the four laws from _The Four Laws of Financial Prosperity_
(Blaine Harris & Charles Coonradt). Each law has a mechanism in the app rather
than a page of advice:

| Law           | What the app does                                                                                                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tracking**  | Opens straight into the keypad. Days with no record show as holes in the ledger, not as absence.                                                                                                                                                                                                                                          |
| **Targeting** | A goal cannot be saved without a why, an amount and a date — the save button names the missing piece. Each month gets a written target, and it sits on the launch screen so it cannot be stopped being seen.                                                                                                                              |
| **Trimming**  | Every bucket is `need` / `want` / `give` / `save` / `debt`. Misfiled spending is caught while typing; one-off purchases are kept out of the monthly average. The month view splits income the book's way — 10 % given, 10 % saved, 10 % debt or reserve, 70 % living — and names the share furthest off. Caps are designed but not built. |
| **Training**  | The checks run on every keystroke — a hundred small corrections, not one monthly reckoning. The goal screen keeps the record of months, ✓ or ✗. The monthly close ritual is designed but not built.                                                                                                                                       |

PROJECT-PLAN §2 is the long version, and it is the part worth reading first.
`docs/TRIMMING-AND-TRAINING.md` is the design for the two laws that are not
finished yet.

## Status

**P0 + P1 complete.** Local only: no backend, no sync, no auth, by design. The
next step is not more code, it is fourteen consecutive days of real use
(PROJECT-PLAN §11).

## Run it

```bash
pnpm install
pnpm dev
```

Then <http://localhost:5173>.

```bash
pnpm test     # 203 unit tests — money, ledger, keypad, checks, receivables, goals,
              #             the split, holdings, recurring payments
pnpm check    # svelte-check, TypeScript strict
pnpm lint     # prettier + eslint
pnpm build    # static output in apps/web/build
```

## Install it on the phone

The dev server is not reachable from the phone by default. Either bind it to the
network:

```bash
pnpm --filter web dev --host
```

...or serve the production build:

```bash
pnpm build
npx serve apps/web/build
```

Then open the address on the phone, Chrome menu → _Add to home screen_. The
service worker only registers over `https://` or `localhost`, so for a real
install on the phone the app needs to be served over HTTPS — that is a P2 job.

## Layout

```
apps/web/src/
├─ lib/domain/     pure: money, dates, ids, tape building, keypad state,
│                  the vocabulary and the checks that watch for the mistakes
│                  the old spreadsheet actually made
│                  no Dexie, no fetch, no DOM — this is the tested part
├─ lib/db/         Dexie schema + migrations, and the only file that writes
├─ lib/ui/         hand-rolled components against the token set
├─ lib/styles/     design tokens, self-hosted fonts
└─ routes/         / (entry) · /tape (ledger) · /mesic (month) · /cil (goal)
                   · /jmeni (what it all adds up to) · /settings
```

`docs/PROJECT-PLAN.md` is the specification. `docs/DECISIONS.md` records every
answered question and every deviation. Both are binding on future work.
`docs/TRIMMING-AND-TRAINING.md` is a design, not yet binding — it needs four
rulings first (DECISIONS Q29–Q32).

## The checks

The categories and the checks both come from `Výdaje 2026.xlsx` — eight months
of real entries. Each rule in `lib/domain/checks.ts` names the damage it exists
to prevent, with the figure from the workbook. `docs/DECISIONS.md` has the full
table.

Nothing blocks a save. A check that stops you recording an expense is worse than
the mistake it prevents.

## The rules that are not negotiable

They are listed in PROJECT-PLAN §13. The two that bite hardest:

- **No floating point for money.** Integer haléře, all arithmetic through
  `lib/domain/money.ts`.
- **Soft delete only.** No `DELETE` on user data, ever.
