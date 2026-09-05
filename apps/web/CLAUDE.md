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
`ensureSeeded()` → `catchUpSchedules()` → `catchUpGoalTargets()`, then requests
storage persistence. Anything that must happen "when the app opens" belongs
there — there is no server and no background worker to do it anywhere else.

---

## Svelte 5, as used here

**Runes only.** `$state`, `$derived`, `$props`, `$effect`. No `export let`, no
stores except the `liveQuery` observables Dexie hands back.

**Reading a `liveQuery`.** The `$store` auto-subscription works inside the main
scroll region and is not to be trusted anywhere else — see the root
`CLAUDE.md`. For a binding outside `<main>`, subscribe by hand and assign into
`$state`:

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

The third edition (2026-09-05) is a consumer-banking layout in the manner of
Revolut: a soft-grey ground, white cards raised by luminance alone, one sans
(Inter, self-hosted, variable 400–600), every button a pill, every bucket a
coloured circle with an icon in it. `docs/DESIGN.md` is the system; the handoff
it was built from is `docs/redesign/`.

| Rule                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ |
| The primary pill inverts: `--pill` on `--pill-ink` — ink on white by day, white on black by night                  |
| `--signal` (cobalt) is the accent: the record disc, links, the goal meter, a toggle that is on                     |
| Mint (`--in`) is money **in**, and a money verdict that came out right — a met month, a passed check. Never chrome |
| Money **out** has no hue: it is `--ink`. Most rows in a ledger are outflow, and forty red numbers is noise         |
| `--flag` (amber) means look at this. `--danger` means destroy or refuse                                            |
| A category's colour is a **key** (`--cat-teal` …), stored on the row, read only through `palette.ts`               |
| Light is the default. Dark is the system preference or the explicit choice — black ground, `#16181a` cards         |
| Press is luminance. Nothing scales. Shadow only under `Sheet` and `Toaster`                                        |

Dark is **selected** twice — once under `prefers-color-scheme`, once under
`[data-theme]` — so the Settings toggle wins in both directions. The values are
declared once: a `--dark-*` bank on `:root`, which both blocks do nothing but
point the roles at. Change a dark colour in the bank and nowhere else. An
explicit choice also moves `color-scheme`, or the browser keeps painting native
controls from the system preference.

### Global classes worth knowing

| Class                                  | What it is                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `.page`                                | The one scroll region of a tab screen: a column of cards, `flex: none` each                          |
| `.title`                               | A tab screen's name at 28 px, in the flow, so it scrolls away                                        |
| `.card`, `.card--press`, `.card--list` | White on the ground, 20 px corners; pressable; a card of rows                                        |
| `.label`                               | The card label: 13 px, sentence case, mute. Nothing is uppercase                                     |
| `.row`, `.row__body`, `.row__end`      | The list row: circle · title over sub · amount over note. `--press` to tap                           |
| `.circle`                              | 40 px identity circle, colour via `--c`; `--sm` 34, `--xs` 28, `--lg` 52                             |
| `.meter`, `.meter__fill`               | 6 px track on the soft surface; `data-tone` done / behind                                            |
| `.badge`                               | A 12 px pill: `--in`, `--flag`, `--card`, `--tiny`                                                   |
| `.seg`, `.seg__item`                   | The segmented pill; `aria-pressed` selects; `--soft` inside a card                                   |
| `.btn`                                 | Soft pill 40 px; `--primary` 48 inverted, `--card`, `--quiet`, `--danger`, `--sm`, `--lg`, `--block` |
| `.round`                               | A 40 px round button on the card colour: close, back, settings                                       |
| `.toggle`                              | 40 × 24, `aria-checked`                                                                              |
| `.field`, `.field__input`              | Form primitives: soft, 12 px, 48 px tall, no border, accent ring on focus                            |
| `.facts`, `.tile`, `.well`             | dt/dd rows with hairlines · a soft tile with a label · the recessed slab                             |
| `.hint`, `.link`                       | 13 px mute copy · an accent text link                                                                |
| `Sheet`                                | The modal sheet. Pull the grip down, tap outside or Esc — no `✕`                                     |
| `.visually-hidden`                     | Screen-reader-only                                                                                   |

### Layout

The window never scrolls. Each screen is a fixed frame with its own internal
scrolling — that is what guarantees the keypad can never be pushed below the
fold on a short phone.

`--touch: 44px` is the floor for anything you aim at; primary pills are 48,
keypad keys 56. Nothing is drawn under 44 and hit bigger any more — the
transparent-inset trick of the second edition went with its 24 px controls.

The tab bar floats: a frosted pill (`--glass`, backdrop blur, `--elev-bar`)
absolutely positioned over the page's bottom edge. `.app:has(.tabbar)` sets
`--page-end` and `--toast-lift` so the last row and a confirmation both clear
it. `/zapis` deliberately has no tab bar — the keypad owns the
bottom of the phone, and the bar's centre disc is how you get there.

---

## Routes

| Route        | Screen                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `/`          | Domů. The launch route: the month's net, the actions, the cards               |
| `/zapis`     | Zápis. The keypad, full-screen, no bar; `✕` returns where it came from        |
| `/tape`      | Výpis — reverse chronological, running balance, a card per day                |
| `/prehled`   | Přehled — Měsíc \| Platby behind one segmented pill, the month switcher above |
| `/ja`        | Já — the hub: Cíl, Jmění and Nastavení as cards                               |
| `/cil`       | The goal — the why, this month's figure, the record of months                 |
| `/jmeni`     | Holdings and the `celkem` total — and the only place one is edited            |
| `/nastaveni` | Accounts, categories (with the icon/colour editor), theme, sync, data         |

The bar is five slots — Domů · Výpis · ⊕ · Přehled · Já. The three detail
screens keep Já lit. `/mesic` and `/platby` are `+page.ts` redirects into
`/prehled`.

---

## Testing

Vitest, node environment, `requireAssertions: true`. Twenty-four files, **508
tests**. Most are against `lib/domain/` — the pure layer, which is the whole
point of the layer being pure.

Six files are the exceptions and each earns it:

| File                  | Why it is not in `domain/`                                                     |
| --------------------- | ------------------------------------------------------------------------------ |
| `db/repo.test.ts`     | The backup and the wipe **are** persistence; in the abstract they test nothing |
| `db/schema.test.ts`   | Migrations, run against a database actually built at the old version           |
| `sync/engine.test.ts` | The outbox drain against a stubbed `fetch`                                     |
| `sync/pair.test.ts`   | The pre-flight probe — the sentence a wrong address produces                   |
| `ui/tint.test.ts`     | Which currency tints the ground                                                |
| `ui/palette.test.ts`  | The style accessor's fallbacks, and the derived account and holding colours    |

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

`lib/db/schema.ts` holds the `migrations` array, currently at **v13**. Add a new
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

`resetLedger` is the only mutation that touches every table at once. It flags
what was recorded, keeps what was configured, and puts the account's opening
balance back to zero — the long version is `DECISIONS.md` under "Začít znovu".
Soft, like every other delete, so the tombstones sync like ordinary rows.

`exportBackup` / `importBackup` are the copy of the ledger that survives a
cleared browser profile on an unpaired device. `importBackup` implements the same
last-write-wins merge the sync layer uses, and refuses a file written by a newer
build rather than merging it with the unknown tables dropped.

Both `importBackup` and `applyRemotePage` run every row through
`domain/rows.ts` → `checkRow()` before writing it — they are the two doors
that skip the type system, and one corrupt amount through either blanked
every screen (DECISIONS, Q57). A refused row is skipped, counted (`skipped` on
the result) and named on the console; the rest of the file or page still
merges, and the pull cursor moves past it.

`meta` holds device preferences, not ledger data: the device id, the active
account and the folded months. (`profileName` was written by one build on
2026-09-05 and read by nothing since — Q55.)

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
- **`pair()` snapshots `ledgerKeys()` before its first pull** and passes the
  set to `seedOutbox`, so the backfill sends what was here and not what just
  came down — the server would only answer "superseded", once per row, for
  the whole ledger. A snapshot rather than a `deviceId` test, because a
  restored backup is this device's to push whichever phone wrote it.
- **The server address defaults to `location.origin`**, because the deployment
  serves the client from the API's own origin (`deploy/`, `DEPLOYMENT.md`).
  `pair()` asks `/api/v1/health` first, so a wrong address fails with a sentence
  about the address rather than a status code from whatever else is on that host.
