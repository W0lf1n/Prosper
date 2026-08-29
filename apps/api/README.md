# Prosper API — the sync server

ASP.NET Core 10 Minimal API + EF Core + Postgres 16. It implements
`docs/PROJECT-PLAN.md` §10 and nothing else.

**The app does not need it.** Prosper is offline-first: the ledger lives in
IndexedDB on the device, and every screen works with this server permanently
down. What it adds is a second copy and a merge point between two devices.

---

## What it is, and what it is deliberately not

The server is **durable storage and a cross-device merge point** — not an
authority on what a transaction means. It never computes a balance, never
validates a category, and never touches money. It stores the client's row as
JSON and reasons about exactly four fields: which entity, which id, when it was
written, and by which device.

That is why there is one `changes` table rather than ten typed ones. §10.2
requires a server-assigned monotonic cursor **across every entity**, and ten
tables cannot produce one without a log table alongside them. This is that log
table, and having it be the storage as well is one moving part rather than
eleven.

The full reasoning is in `docs/DECISIONS.md`.

---

## Endpoints

| Method | Path                | What                                          |
| ------ | ------------------- | --------------------------------------------- |
| `GET`  | `/api/v1/health`    | `{ ok, version }`. No auth                    |
| `POST` | `/api/v1/pair`      | Code in, `{ deviceId, token }` out            |
| `POST` | `/api/v1/sync/push` | A batch of rows. Idempotent on `(entity, id)` |
| `GET`  | `/api/v1/sync/pull` | `?since=<cursor>&limit=500`, in cursor order  |

Everything but `health` and `pair` needs `Authorization: Bearer <token>`.

The wire types live in `packages/contracts` and are mirrored here in
`Sync/Contracts.cs`.

---

## The merge rule

Last-write-wins on `updatedAt`, ties broken on `deviceId` by **ordinal** string
compare — the same function the client runs in `mergeDecision`. It is written
twice because the two sides are two languages, and it is tested twice for the
same reason.

`updatedAt` is a client clock and that is accepted, not overlooked: one person,
their own devices, skew measured in seconds. A server clock would be worse — it
would make a row's version depend on when it happened to arrive, so a phone
that was offline for a week would win every conflict on reconnect.

**A delete is never undone by a merge.** The winner decides every other field;
`isDeleted` is the one where either side saying "gone" wins for good.

---

## Run it

### Locally, without Docker

Postgres in production, SQLite for a laptop. Same EF model either way — a sync
layer nobody can run locally is a sync layer nobody checks.

```bash
dotnet run --project src/Prosper.Api
```

with:

```bash
ASPNETCORE_URLS=http://127.0.0.1:5299 Database__Provider=sqlite ConnectionStrings__Sqlite="Data Source=prosper.db" Pairing__Code=123456 Cors__Origins__0=http://localhost:5173 dotnet run --project src/Prosper.Api
```

`Cors__Origins__0` exists only so the Vite dev server on another port can be
developed against. In production the client is served from the same origin and
there is **no CORS policy at all** — a sync endpoint any page can call is a sync
endpoint any page can drain.

### In production

This server is not deployed on its own. It is one of three containers in
`deploy/docker-compose.yml`, behind the same nginx that serves the client —
which is what makes them one origin and retires the CORS allowlist entirely.

```bash
docker compose up -d --build
```

from `deploy/`, with `POSTGRES_PASSWORD` and `PAIRING_CODE` in a `.env` beside
it. Neither has a default: a default password is one nobody changes, and an
unset pairing code makes the server refuse to pair rather than accept anything.

**The whole runbook — the VPS, the domain, the certificate, the backups — is
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).**

### The database creates itself

There are **no EF migrations here.** On startup the API calls
`EnsureCreatedAsync()` — gated behind `Database:MigrateOnStart`, default true —
which creates `changes`, `devices` and `sync_state` if the database has no
tables, and does nothing otherwise. There is no `dotnet ef database update` step
in this project, on a server or on a laptop.

The consequence worth knowing: `EnsureCreated` never *alters* a schema. It has
not mattered, because the server stores rows as JSON and reasons about four
fields, so a client schema change is not a server concern. If the server model
ever changes, that is the moment to add migrations and switch to
`MigrateAsync()` — not before.

Table names are lowercase; **column names are PascalCase**, because EF takes
them from the property names. Postgres folds unquoted identifiers, so
`select entity from changes` fails and `select "Entity" from changes` works.

[`docs/DEPLOYMENT.md` § The sync database](../../docs/DEPLOYMENT.md#the-sync-database)
has the schema, the inspection commands and the reset.

---

## Tests

```bash
dotnet test
```

50 tests. The ones that reach the database use SQLite in memory rather than the
EF in-memory provider: this code opens transactions and relies on a unique
index, and the in-memory provider honours neither. A fake that cannot fail the
way the real thing fails is a fake that proves nothing.

They cover the merge rule in both directions, the tie-break, the
never-un-delete rule, idempotency, per-row rejection, the cursor staying
monotonic across entities, and an update moving a row to the end of the cursor
— which is the one that stops a device that has already pulled from missing an
edit.

Eighteen of them are `ClientAddress`, which needs no database at all: which peer
may be believed about who a caller is, and which header is a claim rather than
an observation.

---

## Security notes

- **Tokens are stored as SHA-256 hashes.** The plaintext exists in transit and
  in the client's IndexedDB, nowhere on the server. A database dump does not
  hand anybody a working device.
- **Tokens do not expire.** An expiry logs the phone out at the worst possible
  moment — somewhere with no signal — and recovery needs the code, which is on
  the machine the user is not holding. Revocation is deleting the row.
- **The pairing code is compared in constant time.** It is human-typed,
  which is exactly the shape a timing attack likes.
- **`/api/v1/pair` is rate-limited per client address, and `ClientAddress`
  decides what that means.** The key is `X-Real-IP`, which both nginx layers
  overwrite with their own peer, and it is honoured only from a peer inside a
  private range. `X-Forwarded-For` is deliberately not used: nginx *appends* to
  it, so its first hop is written by the caller.
- **An unset pairing code refuses to pair.** It must never mean "any code will
  do", which is how a private ledger becomes a public one.
- **Row payloads are capped at 64 kB.** A transaction is a few hundred bytes; a
  megabyte of one is a bug or an attack, and the answer is the same either way.

## Backups

`docs/PROJECT-PLAN.md` §14 calls for a nightly `pg_dump`. It is `deploy/backup.sh`
— dump, gzip, keep thirty days, refuse to call a file under a kilobyte a backup —
and `docs/DEPLOYMENT.md` has the cron line.

It is still the **second** copy. The first is IndexedDB on the phone, and the
JSON export in the app's Settings is the only backup anybody has restored from.
A dump nobody has restored is a hypothesis.
