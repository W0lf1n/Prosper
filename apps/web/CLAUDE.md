# CLAUDE.md — apps/web

The SvelteKit PWA. Read the root `CLAUDE.md` first; this file covers only what
is specific to the app.

**Stack:** SvelteKit 2.63 · Svelte 5.56, runes forced · Vite 8 · TypeScript 6
strict · Vitest 4 · Dexie 4.4 · `adapter-static`

---

## Configuration lives in `vite.config.ts`

There is no `svelte.config.js`. The SvelteKit plugin is configured inline —
runes are forced for everything outside `node_modules`, and the adapter is
`adapter-static` with `fallback: '200.html'` and `precompress: true`. Vitest's
config sits in the same file.

`routes/+layout.ts` sets `ssr = false` and `prerender = true`: a local-first app
has nothing useful to render on a server, and Dexie must not be constructed
where `indexedDB` does not exist. That is also why `db()` in `lib/db/schema.ts`
is lazy.

The layout's `load` runs three things on every launch, in this order:
`ensureSeeded()` → `closePreviousDay()` → `catchUpSchedules()`, then requests
storage persistence. Anything that must happen "when the app opens" belongs
there — there is no server and no background worker to do it anywhere else.

---

## Svelte 5, as used here

**Runes only.** `$state`, `$derived`, `$props`, `$effect`. No `export let`, no
stores except the `liveQuery` observables Dexie hands back.

**Reading a `liveQuery`.** The `$store` auto-subscription works inside the main
scroll region and is not to be trusted anywhere else — see the root
`CLAUDE.md`. For a binding in a `<header>`, a `<nav>`, or anything outside
`<main>`, subscribe by hand and assign into `$state`:

```ts
let rows = $state<Txn[]>([]);
$effect(() => liveQuery(() => repo.something()).subscribe((v) => (rows = v)).unsubscribe);
```

**Never derive a "before and after" figure across an `await`.** Capture it
before the write. A `liveQuery` may already have flushed by the time the
`await` returns, and a message that is right only when it wins that race is a
message that is sometimes wrong.

---

## The design system

Tokens are in `lib/styles/tokens.css` and that is the **only** place a colour is
defined. A literal hex in a component is a bug.

The system is called _graphite instrument_: a graphite ground, surfaces raised
by **luminance** rather than by boxes, hairlines only where an edge is
load-bearing, and exactly one signal colour.

| Rule                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- |
| `--signal` (mint) is the primary action, the current selection, and money **in**. Nothing else — it is never decoration |
| Money **out** has no hue: it is `--ink`. Most rows in a ledger are outflow, and forty red numbers is noise              |
| `--flag` (amber) means look at this. `--danger` (coral) means destroy or refuse                                         |
| Elevation inverts between themes. Use `--raised`, never a hard-coded `--surface-N`                                      |
| Dark is the theme this was designed for. Light is its daylight counterpart, not the default                             |

Dark is **selected** twice — once under `prefers-color-scheme`, once under
`[data-theme]` — so the Settings toggle wins in both directions. The values are
declared once: a `--dark-*` bank on `:root`, which both blocks do nothing but
point the roles at. Change a dark colour in the bank and nowhere else. An
explicit choice also moves `color-scheme`, or the browser keeps painting native
controls from the system preference.

### Global classes worth knowing

| Class                  | What it is                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| `.money`               | Mono, `tabular-nums`, right-aligned. **All money, always**            |
| `.money--out` / `--in` | The direction's colour                                                |
| `.slab`                | A raised surface: hairline, lit top edge, `--radius-lg`. No shadow    |
| `.u-label`             | The micro-label. The only place uppercase is allowed                  |
| `.perforation`         | The score line separating two parts of one slab                       |
| `.field`, `.btn`       | Form and button primitives, with `--primary` / `--quiet` / `--danger` |
| `.visually-hidden`     | Screen-reader-only                                                    |

### Layout

The window never scrolls. Each screen is a fixed frame with its own internal
scrolling — that is what guarantees the keypad can never be pushed below the
fold on a short phone.

`--touch: 44px` is the floor for anything you aim at. A control drawn at
`--control: 24px` carries a transparent `::after` that pushes its hit area back
out to `--touch`, which is why rows of small controls keep a `--control-gap`
gutter: **that gutter is where the hit areas live.** Shrink it and neighbouring
targets steal each other's taps.

`.app:has(.tabbar)` raises `--toast-lift` so a confirmation never parks on top
of the navigation. The entry route deliberately has no tab bar — the keypad owns
the bottom of the phone, and the bar's centre disc is how you get back there.

---

## Routes

| Route       | Screen                                                                  |
| ----------- | ----------------------------------------------------------------------- |
| `/`         | Entry. The launch route, and the one protected hardest                  |
| `/tape`     | The ledger — reverse chronological, running balance, gap days as holes  |
| `/mesic`    | The month — totals, Kontrola, Dluží mi, the split, buckets ranked       |
| `/cil`      | The goal — the why, this month's figure, the record of months           |
| `/jmeni`    | Holdings and the `celkem` total. Reached from the `/` header, not a tab |
| `/settings` | Account, categories, recurring payments, theme, backup                  |

Four of the six are in the tab bar (`/tape`, `/mesic`, `/cil`, `/settings`) with
the record disc between them. `/jmeni` is not, on purpose: it is the screen you
open once a month.

---

## Testing

Vitest, node environment, `requireAssertions: true`. Nineteen files, **341
tests**. Most are against `lib/domain/` — the pure layer, which is the whole
point of the layer being pure.

Four files are the exceptions and each earns it:

| File                  | Why it is not in `domain/`                                              |
| --------------------- | ----------------------------------------------------------------------- |
| `db/repo.test.ts`     | The backup **is** persistence; testing it in the abstract tests nothing |
| `db/schema.test.ts`   | Migrations, run against a database actually built at the old version    |
| `sync/engine.test.ts` | The outbox drain against a stubbed `fetch`                              |
| `sync/pair.test.ts`   | The pre-flight probe — the sentence a wrong address produces            |

The first three use `fake-indexeddb/auto`.

There are no component tests and no E2E suite in the repository. Single user,
disproportionate maintenance cost — `PROJECT-PLAN.md` §13.

**A new rule gets a test before it gets a screen.** The one test that must never
be deleted is in `holdings.test.ts`: `summariseMonth` and `prosperitySplit`
asserted byte-identical with a full set of holdings in the database. It fails if
anyone ever wires unrealised growth into income, which would make the
10/10/10/70 split fiction.

Manual, before any phase ships: airplane mode → enter 5 transactions →
force-close → reopen → reconnect → verify.

---

## Data layer

`lib/db/schema.ts` holds the `migrations` array, currently at **v6**. Add a new
entry; never edit an existing one, even in development — a released version is
already on the phone. `schema.test.ts` builds a database at the _old_ version
and opens it with the current code: a migration that has only ever run against
an empty database has not been tested.

`lib/db/repo.ts` is the only file that writes — with **one deliberate
exception**: `sync/engine.ts` → `applyRemotePage` writes rows that arrived from
the server. It has to. Going through `repo.ts` would re-stamp `updatedAt` with
this device's clock and enqueue them straight back out, which is a sync loop
with extra steps. It writes a **page** at a time — one transaction, one
`bulkGet`, one `bulkPut` per table — because row-at-a-time meant two implicit
transactions per row on the main thread.

Every mutation stamps `updatedAt` / `deviceId` and calls `enqueue()`, which is
gated on whether this device has ever been paired. Adding a mutation means
adding it there, not in a component.

`exportBackup` / `importBackup` are the copy of the ledger that survives a
cleared browser profile on an unpaired device. `importBackup` implements the same
last-write-wins merge the sync layer uses, and refuses a file written by a newer
build rather than merging it with the unknown tables dropped.

## Sync

`lib/sync/` — `engine.ts` (drain, pull, merge), `pair.ts`, `status.svelte.ts`.

Three things about it that are not obvious:

- **Nothing awaits a cycle.** Rule 5. A cycle runs in the background and writes
  to `status.svelte.ts`; Settings reads that, and no other screen mentions sync.
- **Push before pull, always**, in one cycle.
- **`adoptRemoteLedger` runs after every pull**, not only at pairing. Every
  device seeds its own account, so pairing two produces two — and pairing them in
  quick succession is a race the protocol cannot order. It answers the question
  **once**: the `ledgerAdopted` meta flag is set the moment the answer stops
  being able to change, because two live accounts is an ordinary steady state
  and the scans behind it are not something to run every cycle forever.
- **A cycle is scheduled, never polled.** The triggers are §10.7's: app
  foreground, back online, after a write (debounced ten seconds, through
  `setOutboxListener`), and the manual button. `IDLE_POLL_MS` is only the safety
  net under them, for what another device pushed while this one sat open.
- **The server address defaults to `location.origin`**, because the deployment
  serves the client from the API's own origin (`deploy/`, `DEPLOYMENT.md`).
  `pair()` asks `/api/v1/health` first, so a wrong address fails with a sentence
  about the address rather than a status code from whatever else is on that host.
