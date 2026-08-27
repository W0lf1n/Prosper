# @vydaje/contracts

The sync protocol, as TypeScript types. `docs/PROJECT-PLAN.md` §10 and nothing
else.

This package exists so the client and the server agree on a shape in one place
rather than two. `apps/web` imports it directly; `apps/api` mirrors it in C# in
`Sync/Contracts.cs`.

It ships **one runtime export** — `mergeDecision`, the last-write-wins rule.
Everything else is types and two constants, so importing it costs the client
bundle almost nothing, which matters against a 150 kB brotli budget.

## What is in here

| Export                              | What                                        |
| ----------------------------------- | ------------------------------------------- |
| `SyncRow`, `SyncRejection`          | One row on the wire, and one refusal        |
| `PairRequest` / `PairResponse`      | `POST /api/v1/pair`                         |
| `PushRequest` / `PushResponse`      | `POST /api/v1/sync/push`                    |
| `PullQuery` / `PullResponse`        | `GET /api/v1/sync/pull`                     |
| `HealthResponse`                    | `GET /api/v1/health`                        |
| `mergeDecision`                     | LWW on `updatedAt`, tie-break on `deviceId` |
| `PUSH_BATCH_SIZE`, `PULL_PAGE_SIZE` | The batch limits both sides assume          |

## Rules it is written under

- **The full row travels, never a diff.** A diff needs both sides to agree on a
  base version, which is exactly the thing a last-write-wins merge has decided
  not to track — and a partial row that loses a race leaves the ledger in a
  state neither device ever held.
- **The client generates every id.** UUIDv7. The server never assigns one.
- **A rejection is per row, not per batch.** One malformed row must not cost the
  other 499 their trip.
- **No domain rules live here.** No money arithmetic, no dates, no categories. A
  type here is a wire format, and a wire format is allowed to be dull.

## Changing it

A field added here has to be added in `apps/api/src/Prosper.Api/Sync/Contracts.cs`
in the same change, with the same name and casing — the JSON is camelCase on
both sides, so a rename on one side fails a round-trip test on the other rather
than silently dropping data.

There is no build step and no published artifact. `apps/web` consumes the
TypeScript source through the workspace link.
