<div align="center">

# Výdaje

**An offline-first personal finance tracker that argues with you.**

Records a transaction in under five seconds, one hand, no network — and then
checks the entry _before_ it is saved.

[![License: MIT](https://img.shields.io/badge/license-MIT-000.svg)](LICENSE)
![SvelteKit 2](https://img.shields.io/badge/SvelteKit-2.63-FF3E00.svg)
![Svelte 5](https://img.shields.io/badge/Svelte-5%20runes-FF3E00.svg)
![TypeScript strict](https://img.shields.io/badge/TypeScript-6%20strict-3178C6.svg)
![315 tests](https://img.shields.io/badge/tests-283%20web%20%2B%2032%20api-007850.svg)
![83.2 kB brotli](https://img.shields.io/badge/JS-83.2%20kB%20brotli-007850.svg)
![Offline first](https://img.shields.io/badge/offline-first-555.svg)

<br>

<img src="docs/screens/entry-dark.png" width="270" alt="The entry screen: month total, goal strip, amount, category chips, keypad">
<img src="docs/screens/check-light.png" width="270" alt="A live check firing while typing: “Spíš JÍDLO?” with a one-tap fix">
<img src="docs/screens/month-dark.png" width="270" alt="The month view: net, findings, and outstanding receivables">

</div>

---

## Why it has opinions

Most finance apps are a form over a database. This one is built on the four laws
from _The Four Laws of Financial Prosperity_ (Blaine Harris & Charles Coonradt),
and **each law has a mechanism rather than a page of advice.** A feature that
serves no law does not get built.

| Law           | What the app actually does                                                                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tracking**  | Opens straight into the keypad — no dashboard, no menu, no decision. Days with no record show as **holes** in the ledger, not as absence. A real zero is a separate, explicit mark.                                                                                                                                   |
| **Targeting** | A goal cannot be saved without a why, an amount and a date; the save button names the missing piece rather than accepting the tap and complaining. Each month gets a written commitment, and it sits on the launch screen so it cannot stop being seen.                                                               |
| **Trimming**  | Every bucket carries a `need` / `want` / `give` / `save` / `debt` type. Misfiled spending is caught **while you type**. One-off purchases are kept out of the monthly average. The month splits income the book's way — 10 % given, 10 % saved, 10 % debt or reserve, 70 % living — and names the share furthest off. |
| **Training**  | The checks run on every keystroke — a hundred small corrections, not one monthly reckoning. The goal screen keeps the record of months, ✓ or ✗ against a number you actually agreed to.                                                                                                                               |

It is written in Czech, for one person, from eight months of his own spreadsheet.
That is not an accident — it is the reason the rules are specific enough to be
worth reading.

---

## The checks are the point

Eight months of a real expense spreadsheet showed that the failure mode is not
laziness. It is **quiet miscategorisation that nobody notices until the numbers
are meaningless.**

So every rule in `lib/domain/checks.ts` exists because the spreadsheet already
went wrong that way, and each one carries the figure from the workbook in a
comment so nobody later deletes it as theoretical.

| Rule               | Catches                                                      | From the workbook                            |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------- |
| `misfiled`         | Description matches a different bucket; offers it in one tap | 25 286 Kč of food filed outside JÍDLO        |
| `unclear-number`   | Description carries a number that is not the amount          | "Netflix - 379" recorded as 74 Kč            |
| `vague`            | A large amount with a description that explains nothing      | "opak. obj", 17 074 Kč in one month          |
| `one-off`          | A large expense not yet marked extraordinary                 | a 41 890 Kč front door in with the groceries |
| `refund-as-income` | An inflow that is really somebody paying you back            | "Zůza - bydlení plyn" booked as income       |
| `duplicate`        | Same amount and description within three days                | HBO Max entered as −18 Kč, twice             |
| `other-overflow`   | The dumping-ground bucket past 15 % of recurring outflow     | OSTATNÍ took 100 895 Kč in eight months      |
| `coverage`         | Days with no record — "your totals are lower than reality"   | the spreadsheet had no dates at all          |
| `overspend`        | The month spent more than it earned                          | four of eight months ran a deficit, silently |

**Nothing blocks a save.** A check that stops you recording an expense is worse
than the mistake it prevents.

---

## Screens

<table>
<tr>
<td width="33%" valign="top">
<img src="docs/screens/entry-light.png" alt="Entry screen in the light theme">
<p align="center"><b>Entry</b><br><sub>The launch route. Month standing on top, then the amount in a pool of light, three most-used buckets, keypad. Three actions to a saved row.</sub></p>
</td>
<td width="33%" valign="top">
<img src="docs/screens/tape-dark.png" alt="The ledger tape">
<p align="center"><b>Výpis — the tape</b><br><sub>Reverse-chronological, running balance per row, days separated by score lines, gap days rendered as holes and real zeros marked.</sub></p>
</td>
<td width="33%" valign="top">
<img src="docs/screens/split-dark.png" alt="The 10/10/10/70 split as two rings">
<p align="center"><b>The split</b><br><sub>10 / 10 / 10 / 70 measured against <i>income</i>, not outflow — so overspending shows as a negative remainder instead of summing to a tidy 100 %.</sub></p>
</td>
</tr>
<tr>
<td width="33%" valign="top">
<img src="docs/screens/goal-dark.png" alt="The goal screen">
<p align="center"><b>Cíl — the goal</b><br><sub>The why in your own words, before any number. Then this month's figure, marked <i>committed</i> or merely <i>proposed</i>. Then the record of months.</sub></p>
</td>
<td width="33%" valign="top">
<img src="docs/screens/wealth-dark.png" alt="Holdings and the total">
<p align="center"><b>Jmění — what it adds up to</b><br><sub>Hand-typed holding values with the day each was true. No tickers, no price feed. Growth is never counted as income.</sub></p>
</td>
<td width="33%" valign="top">
<img src="docs/screens/schedules-dark.png" alt="Recurring payments in settings">
<p align="center"><b>Recurring payments</b><br><sub>Declared, not detected. Each one posts automatically or waits for one tap, with the annual cost stated where you set it.</sub></p>
</td>
</tr>
</table>

Both themes are first-class. Dark is the one it was designed for — this is an app
used one-handed, in bed, with the lights off.

---

## Run it

Requires Node 22+ and pnpm 9+ (the lockfile is v9).

```bash
git clone https://github.com/W0lf1n/Prosper.git
```

```bash
pnpm install
```

```bash
pnpm dev
```

Then <http://localhost:5173>. There is nothing else to start — no database to
provision, no API key, no `.env`. The ledger lives in IndexedDB on the device.

| Script       | What it does                                    |
| ------------ | ----------------------------------------------- |
| `pnpm test`  | 203 unit tests against the pure domain layer    |
| `pnpm check` | `svelte-check` under TypeScript strict          |
| `pnpm lint`  | Prettier + ESLint                               |
| `pnpm build` | Precompressed static output in `apps/web/build` |

### On the phone

The dev server is not reachable from a phone by default. Either bind it to the
network:

```bash
pnpm --filter web dev --host
```

...or serve the production build:

```bash
pnpm build && npx serve apps/web/build
```

Open the address on the phone, then Chrome menu → _Add to home screen_. The
service worker only registers over `https://` or `localhost`, so a real install
needs HTTPS.

---

## How it is built

```
apps/web/src/
├─ lib/domain/     PURE — no Dexie, no fetch, no DOM. Every rule lives here,
│                  and every rule is unit tested. This is the tested part.
├─ lib/db/         Dexie schema + migrations, and repo.ts — the only writer.
├─ lib/sync/       Outbox drain, pull, pairing. Never awaited by the UI.
├─ lib/ui/         Hand-rolled components. No component library.
├─ lib/styles/     Design tokens, self-hosted fonts.
└─ routes/         / · /tape · /mesic · /cil · /jmeni · /settings

apps/api/          ASP.NET Core 9 + EF Core + Postgres 16 — optional sync server
packages/contracts The sync protocol, shared by both sides
```

**One runtime dependency: Dexie.** Everything else — UUIDv7, Czech plurals, the
money type, the service worker, the XLSX writer, every component — is written
here, because every package is a bundle-size decision against a 150 kB budget.
The entry route ships **83.2 kB** of JavaScript brotli-compressed, checks engine
and sync layer included, and `pnpm budget` fails the build if that number ever
passes 150.

A few decisions worth stealing:

- **No floating point for money.** Integer haléře, branded as `Minor`, all
  arithmetic in one module. `formatMoney` never divides the value it displays —
  it splits the integer and formats the parts, so the string is exact by
  construction rather than exact by luck.
- **Soft delete only.** No `DELETE` on user data, ever. Every row carries
  `updatedAt` / `deviceId` / `isDeleted` from day one, even though there is no
  server yet, because adding them later is a migration.
- **Goal progress is read off the ledger, never stored.** A contribution is an
  ordinary outflow into the goal's bucket. There is no second set of books, and
  that is the only reason the number can be trusted.
- **A stated number and a computed number never share a column.** An account
  balance is computed; a holding's value is typed in off a statement and stale
  the moment after. They are separate tables so the difference is structural
  rather than a convention someone has to remember.
- **The 10/10/10/70 split is measured against income.** A share of outflow always
  sums to 100 % and can therefore never say the one thing worth knowing.

### Sync, if you want it

Optional, and off until a device is paired. `apps/api` is an ASP.NET Core 9
service that stores each row as JSON and reasons about four fields: which
entity, which id, when it was written and by which device. It never computes a
balance and never touches money — every rule about what a transaction _means_
lives on the client, where it is tested.

Conflicts are last-write-wins on `updatedAt`, ties broken on `deviceId`. **A
delete is never undone by a merge.** The rule is written twice — once in
TypeScript, once in C# — because the two sides are two languages, and it is
tested twice for the same reason.

The client pushes before it pulls, drains its outbox oldest-first, backs off to
five minutes on failure, and never makes the UI wait for any of it.

```bash
docker compose -f apps/api/docker-compose.yml up -d
```

### Design

A system called _graphite instrument_: surfaces raised by **luminance** rather
than by boxes, hairlines only where an edge is load-bearing, and exactly one
signal colour. Money going out has no hue at all — most rows in a ledger are
outflow, and forty red numbers is noise, not information.

All money is monospace, tabular, right-aligned, always. Two amounts in a column
can be compared without reading them. It is functional and it is the visual
identity.

Both faces are self-hosted (97 kB, latin + latin-ext). A font CDN would break
the offline promise.

---

## Status

**Offline-first, and the server is optional.** The app is fully functional with
the network permanently down, and a device that has never been paired never
queues a row or makes a request. Sync adds a second copy and a merge point
between two devices; it does not become the ledger.

| Phase                             | State                                                      |
| --------------------------------- | ---------------------------------------------------------- |
| P0 · Foundation                   | ✅ shipped                                                 |
| P1 · MVP, local only              | ✅ shipped — six screens, checks, PWA                      |
| Targeting · goals                 | ✅ shipped ahead of schedule                               |
| Investments · `/jmeni`            | ✅ shipped, items 5–8 outstanding                          |
| Recurring payments                | ✅ shipped                                                 |
| P2 · Sync                         | not started — the client seam exists, `SYNC_ENABLED=false` |
| P3 · Caps, close ritual, nudge    | designed, not built                                        |
| P4 · Bank import · P5 · Reporting | not started                                                |

The next step is not more code. It is **fourteen consecutive days of real use** —
because real usage will invalidate a meaningful share of the P3 assumptions, and
it is cheaper to learn that first.

**[`docs/TODO.md`](docs/TODO.md) is the single list of everything unfinished**,
including the four defects worth fixing regardless of that gate.

---

## Documentation

These are unusually complete, and deliberately so — the reasoning is the
valuable part, not the code.

| Document                                                         | What it is                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`docs/PROJECT-PLAN.md`](docs/PROJECT-PLAN.md)                   | The specification, describing the app **as it stands**. Binding      |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                         | Every answered question, every deviation, every rejected alternative |
| [`docs/TODO.md`](docs/TODO.md)                                   | The only list of unfinished work                                     |
| [`docs/TRIMMING-AND-TRAINING.md`](docs/TRIMMING-AND-TRAINING.md) | Laws 3 and 4 — design for what is not built yet                      |
| [`docs/INVESTMENTS.md`](docs/INVESTMENTS.md)                     | `/jmeni` — the model, and why growth is not income                   |
| [`docs/RECURRING.md`](docs/RECURRING.md)                         | Declared recurring payments                                          |
| [`CLAUDE.md`](CLAUDE.md)                                         | Working rules, and the traps this codebase already fell into         |

`DECISIONS.md` is worth a look even if you never run the app. It records what an
ordinary household spreadsheet got wrong over eight months, in figures — and
what a piece of software can do about each one.

---

## Contributing

This is a personal app that happens to be readable, not a product looking for
users. Issues and questions are welcome; large feature pull requests probably
are not, because the non-goals list in `PROJECT-PLAN.md` §3 is binding and most
new ideas land on it.

If you do send a patch: `pnpm test`, `pnpm check` and `pnpm lint` all have to
pass, the domain layer stays pure, and a new rule gets a test before it gets a
screen.

## License

[MIT](LICENSE) © Petr Boháč
