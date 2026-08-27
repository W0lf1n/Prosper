# CLAUDE.md

Guidance for Claude Code working in this repository.

**Last revised:** 2026-08-27 · schema v6 · 333 web tests · 32 API tests

---

## What this is

**Výdaje** — an offline-first personal finance PWA in Czech, built so that
recording a transaction takes under five seconds, one hand, no network. One
user, one device, no backend.

It is structured on the four laws from _The Four Laws of Financial Prosperity_
(Harris & Coonradt). That is not decoration: **a feature that serves no law does
not get built.** Before adding anything, name which law it serves.

| Law           | Mechanism in the app                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| **Tracking**  | Launch straight into the keypad; missing days render as holes, not absence   |
| **Targeting** | A goal needs a why, an amount and a date; a month gets a written target      |
| **Trimming**  | `spendType` on every bucket; the 10/10/10/70 split measured against income   |
| **Training**  | Checks on every keystroke; the record of months; days covered and the streak |

---

## Commands

Run from the repository root. Every script proxies to `apps/web`.

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
pnpm test
```

```bash
pnpm check
```

```bash
pnpm lint
```

```bash
pnpm build
```

```bash
pnpm budget
```

```bash
pnpm api:test
```

`pnpm test` runs Vitest once (`vitest --run`); `pnpm --filter web test:unit`
watches. `pnpm check` is `svelte-kit sync && svelte-check` under TypeScript
strict. `pnpm build` writes precompressed static output to `apps/web/build`.
`pnpm budget` measures the entry route against the 150 kB brotli budget and
fails over it — run it after a build. `pnpm api:test` runs the API's 32 tests;
`pnpm api` starts the server.

To run a single test file:

```bash
pnpm --filter web test:unit -- --run src/lib/domain/money.test.ts
```

---

## Layout

```
apps/web/src/
├─ lib/domain/     PURE. No Dexie, no fetch, no DOM. Every rule lives here
│                  and every rule is unit tested.
├─ lib/db/         Dexie schema + migrations, and repo.ts — the only writer.
├─ lib/ui/         Hand-rolled components. No component library.
├─ lib/styles/     tokens.css (the only place colours exist), app.css, fonts.
├─ routes/         / · /tape · /mesic · /cil · /jmeni · /settings
└─ service-worker.ts
```

`apps/api/` is the sync server (ASP.NET Core 9 + EF Core + Postgres 16) and
`packages/contracts/` is the protocol both sides share. Each has its own README.
`apps/web/src/lib/sync/` is the client half.

### The domain layer

| File              | What it owns                                                    |
| ----------------- | --------------------------------------------------------------- |
| `money.ts`        | The **only** place money is computed. Integer haléře, branded   |
| `amount-input.ts` | Keypad state machine — whole koruny first, haléře after a comma |
| `datetime.ts`     | `IsoDate` / `IsoDateTime`, month arithmetic, Czech formatting   |
| `czech.ts`        | Czech plurals — "3 záznamy", not "3 záznamů"                    |
| `ids.ts`          | UUIDv7, hand-rolled, no dependency                              |
| `types.ts`        | The data model. Mirrors the server, when there is one           |
| `vocabulary.ts`   | A hand-written dictionary of Petr's own words. Not ML, ever     |
| `checks.ts`       | The four laws, enforced. Every rule cites its workbook figure   |
| `ledger.ts`       | Tape building, gap days, bucket rankings, recent payees         |
| `receivables.ts`  | Money owed to you                                               |
| `goals.ts`        | Targeting — validation, pace, required monthly, the record      |
| `prosperity.ts`   | The 10/10/10/70 split, measured against income                  |
| `holdings.ts`     | Stated values, staleness, the wealth total                      |
| `recurring.ts`    | Declared schedules — due dates, catch-up, annual cost           |
| `trends.ts`       | Month over month per bucket, against what it usually costs      |
| `coverage.ts`     | Days covered against days elapsed, and the streak               |
| `reconcile.ts`    | The ledger against a bank statement                             |
| `refile.ts`       | Draining a bucket — the month's rows, and where they belong     |
| `xlsx.ts`         | A spreadsheet, hand-rolled, no dependency                       |

---

## Rules that are not negotiable

Violations are bugs regardless of test status. The long version is
`docs/PROJECT-PLAN.md` §13.

1. **No floating point for money.** Ever. Integer minor units, all arithmetic
   through `domain/money.ts`. `formatMoney` never divides the value it displays.
2. **Soft delete only.** No `DELETE` on user data, client or server. `isDeleted`
   is never un-set by a merge.
3. **Client generates all ids.** UUIDv7, `domain/ids.ts`.
4. **Every mutation goes through `db/repo.ts`**, which stamps `updatedAt` /
   `deviceId` and calls the outbox seam. No component writes to Dexie directly.
5. **Never block the UI on network.** Offline is the normal case.
6. **`src/lib/domain/` is pure.** No Dexie, no fetch, no DOM. A new rule belongs
   there, with tests, before it belongs on a screen.
7. **No check may block a save.** Checks advise, offer a one-tap fix, and get out
   of the way. The one exception in the whole app is the goal form.
8. **No component library.** Hand-rolled against the token set.
9. **Colours only from `tokens.css`.** No literal hex in a component.
10. **No `localStorage` for domain data.** IndexedDB only. `localStorage` holds
    the theme preference and nothing else.
11. **Czech dates and money through `Intl`**, never hand-rolled. Czech plurals
    through `domain/czech.ts`.
12. **Ask before adding a dependency.** Every package is a bundle-size decision
    against a 150 kB brotli budget. The app ships one runtime dependency: Dexie.
13. **A schema change is a new entry in the `migrations` array**, never an edit
    to an existing one — a released version is already on the phone.
14. **Update `docs/DECISIONS.md`** whenever a question gets answered or an
    assumption turns out wrong.

---

## Traps this codebase has already fallen into

Each one cost real debugging time. They are recorded in `docs/DECISIONS.md` in
full; this is the short list.

**A live query read after `await` is a coin flip.** Anything a message says
about "before and after" must be captured **before** the write. A toast that
subtracted the just-saved amount from a derived remainder double-counted every
contribution, because `liveQuery` had already flushed.

**`$store` auto-subscription is not to be trusted outside the main scroll
region.** On `/mesic` the month switcher lives in `<header>` and rendered against
the empty first tick, permanently. Subscribe to the `liveQuery` by hand and
assign into `$state` — a `$state` write invalidates every reader unconditionally.

**`overflow: hidden` on a flex item is never cosmetic.** It drops the item's
automatic minimum size to zero. A month card asking for 1 843 px was squashed
into 422 and silently truncated. Any card inside a scrolling flex column needs
`flex: none`.

**IndexedDB cannot index booleans.** `isDeleted`, `isArchived` and `isOneOff` are
stored but not indexed, and filtered in memory.

**Dexie replaces a table's whole index declaration.** Adding one index to `txns`
means restating every existing index in the same `stores` entry, or they are
dropped.

**A field that is absent is not `null`.** The v5 migration backfills
`scheduleId: null` rather than leaving it undefined, because
`row.scheduleId === null` would otherwise answer false for the entire existing
ledger.

**Dexie must not be constructed during SSR/prerender.** `db()` is lazy for
exactly that reason. `ssr = false`, `prerender = true` in `routes/+layout.ts`.

---

## Where the answers are

| Document                        | What it is                                                     |
| ------------------------------- | -------------------------------------------------------------- |
| `docs/PROJECT-PLAN.md`          | The specification. Describes the app **as it stands**. Binding |
| `docs/DECISIONS.md`             | Every answered question and every deviation. Binding           |
| `docs/TODO.md`                  | **The only list of unfinished work.** Start here               |
| `docs/TRIMMING-AND-TRAINING.md` | Laws 3 and 4 — design for what is not built yet                |
| `docs/INVESTMENTS.md`           | `/jmeni` — what shipped, and items 5–8 which did not           |
| `docs/RECURRING.md`             | Declared recurring payments — shipped                          |

`Výdaje 2026.xlsx` — eight months, 547 rows — is the source for the category set
and every rule in `checks.ts`. The analysis is in `DECISIONS.md` under "The
workbook". **Read it before changing a check.**

---

## Before starting anything new

`docs/PROJECT-PLAN.md` §11 puts a gate in front of the next feature: **fourteen
consecutive days of real use** before P2 or P3 begins. Defects and repository
housekeeping are exempt; features are not.

If asked to build something from `TRIMMING-AND-TRAINING.md`, check
`docs/TODO.md` §5 first — most of it is blocked on a question only Petr can
answer.

---

## Language

**The UI is Czech. Code, identifiers, comments, commit messages and docs are
English.** No exceptions in either direction.
