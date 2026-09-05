<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/icon-p.svg">
  <img src="docs/brand/icon-p-light.svg" width="104" alt="Prosper">
</picture>

# Prosper

**An offline-first personal finance tracker that argues with you.**

Records a transaction in under five seconds, one hand, no network — and then
checks the entry _before_ it is saved.

[![License: MIT](https://img.shields.io/badge/license-MIT-1D1D1F.svg)](LICENSE)
![425 tests](https://img.shields.io/badge/tests-375%20web%20%2B%2050%20api-007850.svg)
![85.3 kB brotli](https://img.shields.io/badge/JS-85.3%20kB%20brotli-007850.svg)
![Offline first](https://img.shields.io/badge/offline-first-0066CC.svg)

<br>

<img src="docs/screens/entry-dark.png" width="270" alt="The entry screen: month total, goal strip, a payment waiting to be confirmed, the amount, category chips, keypad">
<img src="docs/screens/check-light.png" width="270" alt="A live check firing while typing: “Spíš JÍDLO?” with a one-tap fix">
<img src="docs/screens/month-dark.png" width="270" alt="The month view: net, the one-off aside, the goal, days covered, and the findings">

</div>

---

## Why it has opinions

Most finance apps are a form over a database. This one is built on the four laws
from _The Four Laws of Financial Prosperity_ (Blaine Harris & Charles Coonradt),
and **each law has a mechanism rather than a page of advice.** A feature that
serves no law does not get built.

| Law           | What the app actually does                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Tracking**  | Opens straight into the keypad. Every day is in the ledger — one with no expense reads **bez výdaje**, and a forgotten one is fixed by typing the row |
| **Targeting** | A goal needs a why, an amount and a date before it can be saved; each month gets a written commitment, and it sits on the launch screen |
| **Trimming**  | Every bucket is `need` / `want` / `give` / `save` / `debt`; misfiled spending is caught while you type; the month splits income 10/10/10/70, the book's way |
| **Training**  | Checks on every keystroke — a hundred small corrections, not one monthly reckoning — and a record of months, ✓ or ✗ against a number you agreed to |

It is written in Czech, for one person, from eight months of his own spreadsheet.
That is not an accident — it is the reason the rules are specific enough to be
worth reading.

---

## Run it

Requires Node 22+ and pnpm 9+.

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

To use it on a phone, serve the build on the network (`pnpm build && npx serve
apps/web/build`, or `pnpm --filter web dev --host`) and _Add to home screen_ —
a real PWA install needs HTTPS, which is what [self-hosting](#sync-if-you-want-it)
provides.

| Script       | What it does                                             |
| ------------ | -------------------------------------------------------- |
| `pnpm test`  | 375 unit tests, most against the pure domain layer       |
| `pnpm check` | `svelte-check` under TypeScript strict — 0 errors        |
| `pnpm lint`  | Prettier + ESLint                                        |
| `pnpm build` | Precompressed static output in `apps/web/build`          |
| `pnpm budget`| The entry route against the 150 kB brotli budget         |

---

## The checks are the point

Eight months of a real expense spreadsheet showed that the failure mode is not
laziness. It is **quiet miscategorisation that nobody notices until the numbers
are meaningless.**

So every rule in `lib/domain/checks.ts` exists because the spreadsheet already
went wrong that way, and each one carries the figure from the workbook in a
comment so nobody later deletes it as theoretical.

| Rule                | Catches                                                       | From the workbook                            |
| ------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `misfiled`          | Description matches a different bucket; offers it in one tap  | 25 286 Kč of food filed outside JÍDLO        |
| `unclear-number`    | Description carries a number that is not the amount           | "Netflix - 379" recorded as 74 Kč            |
| `vague`             | A large amount with a description that explains nothing       | "opak. obj", 17 074 Kč in one month          |
| `one-off`           | A large expense not yet marked extraordinary                  | a 41 890 Kč front door in with the groceries |
| `refund-as-income`  | An inflow that is really somebody paying you back             | "Zůza - bydlení plyn" booked as income       |
| `duplicate`         | Same amount and description within three days                 | HBO Max entered as −18 Kč, twice             |
| `other-overflow`    | The dumping-ground bucket past 15 % of recurring outflow      | OSTATNÍ took 100 895 Kč in eight months      |
| `missing-recurring` | A payee seen three months running, absent from this one       | a subscription cancelled, or a month missed  |
| `overspend`         | The month spent more than it earned                           | four of eight months ran a deficit, silently |

**Nothing blocks a save.** A check that stops you recording an expense is worse
than the mistake it prevents.

---

## How it is built

```
apps/web/src/
├─ lib/domain/     PURE — no Dexie, no fetch, no DOM. Every rule lives here,
│                  and every rule is unit tested. This is the tested part.
├─ lib/db/         Dexie schema + migrations, and repo.ts — the only writer.
├─ lib/sync/       Outbox drain, pull, pairing. Never awaited by the UI.
├─ lib/ui/         Hand-rolled components. No component library.
├─ lib/styles/     tokens.css — the only place colour exists — and app.css.
└─ routes/         / · /zapis · /tape · /prehled · /ja · /cil · /jmeni · /nastaveni

apps/api/          ASP.NET Core 10 + EF Core + Postgres 16 — optional sync server
packages/contracts The sync protocol, shared by both sides
deploy/            Compose, both nginx configs, the nightly dump
```

**One runtime dependency: Dexie.** Everything else — UUIDv7, Czech plurals, the
money type, the service worker, the XLSX writer, every component — is written
here, because every package is a bundle-size decision against a 150 kB brotli
budget. The entry route ships **85 kB** of JavaScript, checks engine and sync
layer included, and `pnpm budget` fails the build if that ever passes 150.

The decisions worth stealing — integer-only money, soft delete from day one,
goal progress read off the ledger rather than stored — are recorded with their
reasoning in [`docs/DECISIONS.md`](docs/DECISIONS.md), which is worth a look
even if you never run the app: it is eight months of an ordinary household
spreadsheet going wrong, in figures, and what a piece of software can do about
each one.

---

## Sync, if you want it

Optional, and off until a device is paired. The app is fully functional with the
network permanently down; sync adds a second copy and a merge point between two
devices. The server stores rows as JSON and never touches money — every rule
about what a transaction _means_ lives on the client, where it is tested.

Three containers behind one domain — the app, the sync server, Postgres — with
one loopback-bound port published and no CORS to configure:

```bash
cd deploy && cp .env.example .env && docker compose up -d --build
```

**[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** is the runbook: the VPS, the
nginx vhost, the certificate, pairing the second device, and the nightly dump.

---

## Design

The third edition, since 2026-09-05: a Revolut-inspired layout — a soft-grey
ground, white cards, one sans (Inter) at three weights, every button a pill,
every bucket a coloured circle with an icon, and a five-slot bar with a record
disc in the middle. Money out still has no hue and one cobalt accent is still
the only chrome. The system is **[`docs/DESIGN.md`](docs/DESIGN.md)**; the
handoff it was built from is in `docs/redesign/`.
---

## Status

Offline-first and local-only shipped; sync, recurring payments, goals and the
wealth screen shipped after it. The next step is not more code — it is
**fourteen consecutive days of real use**, because real usage will invalidate a
share of the assumptions behind what comes next, and it is cheaper to learn
that first. **[`docs/TODO.md`](docs/TODO.md)** is the single list of everything
unfinished.

---

## Documentation

These are unusually complete, and deliberately so — the reasoning is the
valuable part, not the code.

| Document                                                          | What it is                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`docs/PROJECT-PLAN.md`](docs/PROJECT-PLAN.md)                    | The specification, describing the app **as it stands**. Binding      |
| [`docs/DECISIONS.md`](docs/DECISIONS.md)                          | Every answered question, every deviation, every rejected alternative |
| [`docs/TODO.md`](docs/TODO.md)                                    | The only list of unfinished work                                     |
| [`docs/DESIGN.md`](docs/DESIGN.md)                                | The design system — third edition, the Revolut-inspired layout       |
| [`docs/TRIMMING-AND-TRAINING.md`](docs/TRIMMING-AND-TRAINING.md)  | Laws 3 and 4 — design for what is not built yet                      |
| [`docs/INVESTMENTS.md`](docs/INVESTMENTS.md)                      | `/jmeni` — the model, and why growth is not income                   |
| [`docs/RECURRING.md`](docs/RECURRING.md)                          | Declared recurring payments                                          |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                        | Running it on a VPS — Docker, nginx, TLS, backups                    |
| [`CLAUDE.md`](CLAUDE.md)                                          | Working rules, and the traps this codebase already fell into         |

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
