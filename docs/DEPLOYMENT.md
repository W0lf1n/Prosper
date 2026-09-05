# Deployment — running Prosper on a VPS

**Revised:** 2026-08-28
**Audience:** whoever is holding the SSH key

> This is the rest of P2, and none of it is application code. `TODO.md` §4.1 is
> the list it closes.

---

## First, the thing that is easy to get backwards

**The app does not need any of this.** Prosper is offline-first: the ledger
lives in IndexedDB on the device, every screen works with this server
permanently down, and a device that has never been paired never queues a row or
makes a request. Nothing below is a dependency — it is an addition.

What a server buys is exactly two things:

1. **A second copy** of the ledger, somewhere that is not one phone.
2. **A merge point**, so a phone and a laptop are the same ledger rather than
   two.

The server is durable storage and a merge point and nothing else. It never
computes a balance, never validates a category, never touches money. Every rule
about what a transaction _means_ lives on the client, where it is tested.

---

## What runs where

```
                            prosper.example.com
                                     │  443, TLS
┌────────────────────────────────────▼─────────────────────────────────────┐
│ VPS                                                                      │
│                                                                          │
│   nginx (host)  ── certbot renews the certificate                        │
│        │ proxy_pass http://127.0.0.1:8080                                │
│        ▼                                                                 │
│   ┌────────────────── docker compose, deploy/ ───────────────────────┐   │
│   │                                                                  │   │
│   │   web    nginx + the static PWA          :80  ← the only         │   │
│   │    │     location /api/ ──────────┐           published port,    │   │
│   │    │                              │           bound to loopback  │   │
│   │    ▼                              ▼                              │   │
│   │   /usr/share/nginx/html      api  ASP.NET Core 10  :8080          │   │
│   │   (200.html, _app/…)          │   not published                  │   │
│   │                               ▼                                  │   │
│   │                              db   Postgres 16                    │   │
│   │                                   volume: pgdata                 │   │
│   └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│   cron 03:17 ── deploy/backup.sh ── pg_dump | gzip → /var/backups        │
└──────────────────────────────────────────────────────────────────────────┘
```

**One origin, on purpose.** The client and the API answer on the same domain,
because the container's nginx proxies `/api/` to the API. Three things follow
from that and each of them is a reason:

- **The CORS allowlist is retired.** `Cors:Origins` in the API is left unset in
  production; it exists only so the Vite dev server on another port can be
  developed against. A sync endpoint any page can call is a sync endpoint any
  page can drain.
- **The address a device types when pairing is the address it already has
  open**, so Settings can prefill it and nobody types a domain on a phone
  keyboard.
- **Only one port is published, and it is bound to `127.0.0.1`.** Postgres and
  the API are not reachable from outside the compose network at all. A firewall
  rule that is missing cannot expose them, because there is nothing bound to a
  public interface to expose.

---

## What you need before you start

| Thing        | What specifically                                                        |
| ------------ | ------------------------------------------------------------------------ |
| A VPS        | 1 vCPU and 10 GB disk runs it comfortably — one person's ledger is small. **2 GB RAM**, though: the images are built on the box, and the Vite build is the hungry step. 1 GB works with 2 GB of swap |
| A domain     | An `A` record (and `AAAA` if you have v6) pointed at the VPS, resolving  |
| Docker       | Engine 24+ with the compose plugin — `docker compose`, not `docker-compose` |
| nginx        | On the host, plus certbot with its nginx plugin                          |
| Ports open   | 80 and 443 inbound. Nothing else                                         |

`80` has to be open even though the app is HTTPS-only: certbot proves the domain
over it.

On a fresh Debian/Ubuntu box:

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx git
```

Docker's own repository, rather than the distribution's, is what has a current
compose plugin:

```bash
curl -fsSL https://get.docker.com | sudo sh
```

---

## The deployment, start to finish

### 1. Get the repository onto the box

```bash
sudo git clone https://github.com/W0lf1n/Prosper.git /srv/prosper
```

### 2. Write the two secrets

```bash
cd /srv/prosper/deploy && cp .env.example .env
```

Then fill in `.env`. Neither value has a default and compose refuses to start
without them:

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
```

```bash
shuf --random-source=/dev/urandom -i 100000000000-999999999999 -n 1   # PAIRING_CODE
```

`POSTGRES_PASSWORD` is read once, when the volume is first created. Changing it
later does not change the password the database already has.

`PAIRING_CODE` is what a device types once, in Settings, to be handed a token.
It is digits because it is typed on a phone — and it is the only thing between
somebody and your ledger, so treat it as a password even though it does not look
like one. The server compares it in constant time.

**Digits, not hex.** The pairing field asks the phone for a numeric keypad, so a
code with letters in it is one you cannot type on the device that has to type
it. The server accepts any string — the keyboard is the constraint.

**Twelve of them.** A device pairs once in its life, so length here costs one
person ten seconds, once, and it is the only defence that does not depend on a
fence holding. Both fences in front of `/api/v1/pair` count per client address,
so a caller with ten thousand addresses draws ten thousand allowances: six
digits would fall in twenty minutes, twelve takes thirty-four years, and from a
single address three hundred and forty thousand. The leading digit is never
zero, so a code is unambiguously twelve characters and nothing between here and
the phone can quietly eat one.

### 3. Start the three containers

```bash
cd /srv/prosper/deploy && docker compose up -d --build
```

The first build takes a few minutes — a pnpm install and a `dotnet publish`.
After that:

```bash
curl -s localhost:8080/api/v1/health
```

`{"ok":true,"version":"…"}` means all three are up and the web container is
proxying to the API. If it hangs or 502s, go to **Troubleshooting**.

The database created itself while that was happening — the role, the database
and three tables, with nothing to run by hand. **[The sync
database](#the-sync-database)** is what happened and how to look at it.

### 4. Give the domain to nginx

```bash
sudo cp /srv/prosper/deploy/nginx/prosper.conf.example /etc/nginx/sites-available/prosper.conf
```

```bash
sudo sed -i 's/prosper.example.com/YOUR.DOMAIN/g' /etc/nginx/sites-available/prosper.conf
```

```bash
sudo ln -s /etc/nginx/sites-available/prosper.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

The app now answers on `http://YOUR.DOMAIN` — and it is not finished, because
**a service worker will not register over plain HTTP.** No home-screen install,
no offline, which is most of the product.

### 5. The certificate

```bash
sudo certbot --nginx -d YOUR.DOMAIN
```

Certbot edits the vhost in place: adds `listen 443 ssl`, the certificate paths,
and a permanent redirect from `:80`. It also installs the renewal timer, which
is the part people forget to check:

```bash
sudo systemctl list-timers | grep certbot
```

```bash
sudo certbot renew --dry-run
```

### 6. The backup

```bash
sudo crontab -e
```

```
17 3 * * *  /srv/prosper/deploy/backup.sh >> /var/log/prosper-backup.log 2>&1
```

Then run it once by hand, now, rather than finding out at 03:17:

```bash
sudo /srv/prosper/deploy/backup.sh
```

And restore from it once, on purpose, into a throwaway database. A dump nobody
has restored is a hypothesis. The command is at the bottom of `backup.sh`.

The dumps are created `0600` under a `0700` directory — the script sets its own
umask, and re-applies the mode to a directory that already existed — because a
dump is the whole ledger in plain text and root is the only reader it has.

---

## The sync database

**Short version: you do not create it.** There is no `createdb`, no
`dotnet ef database update`, no schema file to apply. Step 3 above is the whole
of it — `docker compose up -d --build` and the database, the role and the three
tables exist. This section is here because "create the database" having no
command reads as an omission rather than as an answer, and because the two
things that _can_ go wrong are both invisible until they bite.

### What step 3 actually does, in order

1. **`db` starts first.** `api` declares
   `depends_on: db: condition: service_healthy`, and `db` has a `pg_isready`
   healthcheck, so the API is not started until Postgres is accepting
   connections. This ordering is load-bearing: the API does not retry its first
   connection, it throws.
2. **Postgres creates the role and the database** from `POSTGRES_USER`,
   `POSTGRES_PASSWORD` and `POSTGRES_DB` — all three `prosper`, bar the
   password. This happens **only on the first start of an empty `pgdata`
   volume**, and never again. It is the reason changing `POSTGRES_PASSWORD` in
   `.env` afterwards does nothing except break the API's connection string.
3. **The API creates the schema.** On startup it calls `EnsureCreatedAsync()`,
   gated behind `Database:MigrateOnStart` (default `true`). That call creates
   the tables if the database has none, and does nothing at all otherwise.

There are **no EF migrations in this repository**, and that is a decision rather
than an oversight — see the caveat below.

### The three tables

| Table        | Rows                     | What it holds                                                     |
| ------------ | ------------------------ | ----------------------------------------------------------------- |
| `changes`    | one per ledger row       | The ledger as the server holds it                                 |
| `devices`    | one per paired device    | `Id`, `Name`, the token's SHA-256 hash, `PairedAt`, `LastSeenAt`  |
| `sync_state` | exactly one, eventually  | `LastSeq` — the cursor allocator                                  |

`changes` is unique on `(Entity, EntityId)`, so a push updates a row in place
rather than appending: the table stays the size of the ledger, not the size of
its history. The history that matters is the ledger's own soft deletes, which
are rows like any other.

`changes.Seq` is the pull cursor — unique, monotonic, and shared across every
entity. It is handed out from `sync_state` inside the same transaction as the
rows it numbers, rather than by a Postgres sequence, because a sequence is not
transactional: a push that rolled back would leave a hole in the cursor space,
and a client that had already stored the higher number would then skip whatever
filled that hole later.

`sync_state` is written lazily, on the first push, not seeded at creation. A
freshly created database with an empty `sync_state` is correct, not broken.

### Postgres folds unquoted identifiers, and this schema is PascalCase

The table names are lowercase — `changes`, `devices`, `sync_state` — because
they are set explicitly with `ToTable(...)`. The **column** names are not: EF
takes them from the property names, so they are `"Entity"`, `"EntityId"`,
`"UpdatedAt"`, `"DeviceId"`, `"IsDeleted"`, `"Payload"`, `"Seq"`.

Postgres folds an unquoted identifier to lowercase, so this fails:

```sql
select entity, count(*) from changes group by entity;   -- column "entity" does not exist
```

and this is the same query, working:

```sql
select "Entity", count(*) from changes group by "Entity";
```

It is worth knowing before the first time you look inside, because the error
names a column you can see in the table.

### Checking that it is really there

`/api/v1/health` answers without touching the database, so it is not proof of
anything below the API. This is:

```bash
cd /srv/prosper/deploy && docker compose exec db psql -U prosper -d prosper -c '\dt'
```

Three tables and you are done. After a device has paired and synced:

```bash
cd /srv/prosper/deploy && docker compose exec db psql -U prosper -d prosper -c 'select "Entity", count(*) from changes group by "Entity" order by 2 desc;'
```

```bash
cd /srv/prosper/deploy && docker compose exec db psql -U prosper -d prosper -c 'select "Id", "Name", "PairedAt", "LastSeenAt" from devices;'
```

`LastSeenAt` moving is the shortest proof that sync is running rather than
merely configured.

### What "one user" means in this schema

There is no user table and no owner column. Nothing here is scoped to a person:
`changes` is _the_ ledger, singular, and `devices` is the only place any
multiplicity exists at all. Two devices holding the same pairing code are two
views of one ledger, which is the entire product.

That is worth stating plainly because it is the part that does not generalise. A
second **user** is not a row somewhere — it would need an owner column on
`changes`, that column threaded through every query in `SyncService`, and an
authorisation model on a server whose whole virtue is not having one. Adding a
second **device** needs none of that, and is what the pairing code is for.

So: one code, one ledger, as many devices as you own.

### The caveat with `EnsureCreated`

`EnsureCreatedAsync()` creates a schema. It never alters one. If the server
model ever gains a column, an existing database keeps the old schema silently
and the API fails on the first query naming the new column — with no migration
error, because nothing tried to migrate.

This has not bitten because the server model has not changed since it was
written, and it is unlikely to: the server stores the client's row as JSON and
reasons about four fields, so **a client schema change is not a server
concern**. Dexie migrations happen on the device.

If the server model does change, the honest fix at that point is to add EF
migrations and switch the startup call to `MigrateAsync()`. Generating a
migration history now, for a schema that has never moved, would be ceremony.

### Running the database on a laptop instead

The same EF model runs on SQLite, so the sync layer can be exercised with no
Docker and no Postgres at all:

```bash
ASPNETCORE_URLS=http://127.0.0.1:5299 Database__Provider=sqlite ConnectionStrings__Sqlite="Data Source=prosper.db" Pairing__Code=123456 Cors__Origins__0=http://localhost:5173 pnpm api
```

`Cors__Origins__0` exists only so the Vite dev server on another port can be
developed against. Production has no CORS policy at all, because the client and
the API answer on one origin.

### Starting the database over

Destructive in a way nothing else in this runbook is — the volume _is_ the
second copy:

```bash
cd /srv/prosper/deploy && docker compose down -v
```

`-v` drops `pgdata`. The next `up` recreates the role, the database and the
three tables from nothing, and **every device is unpaired**, because the tokens
lived in the table that just went. Each one pairs again with the same code.

The ledger itself survives on the phones. A device that pairs into an empty
server pushes everything it has, which is how the second copy gets rebuilt —
and it is the same path a restore takes if you would rather not use the dump.

### Restoring from a dump

```bash
gunzip -c /var/backups/prosper/prosper-2026-08-27.sql.gz | docker compose exec -T db psql --username prosper prosper
```

The dump is taken with `--clean --if-exists`, so it drops what it is replacing
and can be restored over a live database. Do it once, on purpose, into a
throwaway before you need it: a backup nobody has restored from is a hypothesis.

---

## Pairing the devices

The server is up. Nothing syncs yet, because sync is opt-in per device and the
app has not been told the server exists.

**On the phone:**

1. Open `https://YOUR.DOMAIN` in Chrome.
2. Menu → _Add to home screen_. Launch it from the icon from now on.
3. **Nastavení → Synchronizace.** The address is already filled in — it is the
   origin the app was served from, which is the right answer here every time.
4. Type the `PAIRING_CODE`, name the device (`Telefon`), tap **Spárovat**.

What happens next, in this order, and the order is the whole of pairing:

- The app asks `/api/v1/health` whether there is a Prosper server at that
  address at all, so a wrong address fails with a sentence about the address
  rather than a status code.
- The code is exchanged for a device-bound token. The server stores only its
  SHA-256 hash — a database dump does not hand anybody a working device.
- The settings are stored, which is what makes the outbox live. Every write from
  that moment is queued rather than lost.
- The device pulls before it pushes, so it can see whether it is joining a
  ledger that already exists.
- Only then does it backfill everything it already had.

**On the second device**, the same four steps with the same code.

A device that has just been seeded and finds a real ledger on the server **gives
up its own seed** — otherwise two devices means two accounts and two of every
bucket, each showing an empty tape while holding the other's rows. This happens
after every pull rather than only at pairing, because pairing two devices in the
same minute is a race the protocol cannot order.

**Watch `Čeká na odeslání` reach zero.** Until the queue is empty, the second
copy does not exist yet.

---

## Updating

```bash
cd /srv/prosper && sudo git pull && cd deploy && docker compose build --pull && docker compose up -d
```

`--pull` is not decoration. Without it, `build` reuses whatever `node:22-alpine`,
`nginx:1.28-alpine` and the .NET images it pulled the first time — forever. The
base images are where security patches arrive, and this flag is the only thing
that fetches them.

Postgres is untouched by a rebuild — the data is in the `pgdata` volume, not in
the image.

**A schema change is not a server concern.** The server stores rows as JSON and
reasons about four fields; it has never needed to know what a `Holding` is.
Migrations happen in Dexie, on the device, when the new client loads.

The phone picks up a new client on its next launch: the service worker installs
the new shell and takes over. If it seems stuck on the old one, that is a cached
`200.html`, and the container's nginx serves HTML as `no-cache` precisely so it
cannot be.

---

## Troubleshooting

**`curl localhost:8080/api/v1/health` hangs or 502s.**

```bash
cd /srv/prosper/deploy && docker compose ps && docker compose logs --tail=50 api
```

The usual cause is Postgres refusing the password — which means `.env` was
changed after the volume was created. The password lives in the volume, not in
the file.

**The app loads but pairing says the address is wrong.** The health probe is
telling you it did not find a Prosper server. Check that you typed the origin
with `https://` and no path, and that `curl https://YOUR.DOMAIN/api/v1/health`
answers from outside the box.

**Sync worked, then every cycle 502s after a rebuild.** This is the trap the
container's nginx is written to avoid: nginx resolves a literal hostname in
`proxy_pass` once, at startup, and holds that address forever — so an API
container rebuilt with a new IP is proxied to the old one until nginx reloads.
`app.conf` goes through a variable and Docker's resolver for exactly this
reason. If you see it anyway, `docker compose restart web` proves it, and the
`resolver` line is what to look at.

**Pairing 429s the wrong person, or never 429s at all.** Both fences in front of
`/api/v1/pair` count per client address, and the address is only a client's
because of the `real_ip` block in `deploy/nginx/app.conf`. The container's own
access log is the check:

```bash
cd /srv/prosper/deploy && docker compose logs --tail=20 web
```

Public addresses in the first column mean it is working. A `172.` on every line
means nginx is still seeing the host's proxy rather than the caller — everybody
shares one bucket, and one stranger hammering the endpoint keeps your phone from
pairing.

There is a third fence over both, and it is meant to catch everybody at once:
the endpoint as a whole answers twenty attempts an hour, from everywhere
(`PairAttemptsPerHour` in `Program.cs`, with a twenty-a-minute leaky bucket in
`app.conf` one layer out). A caller with many addresses is what the per-address
fences cannot slow, and this is the fence for that. The cost is the obvious
one: a stranger who spends the twenty keeps you from pairing for the rest of
the hour. The same log names the address; pairing is a thing that can wait.

**No install prompt on the phone.** The service worker only registers over
`https://` or `localhost`. Check the certificate first; everything else is a
distraction.

**`Nastavení → Úložiště` says storage is not persistent.** Ask for it there. A
browser may evict IndexedDB under storage pressure, and the ledger is the thing
being evicted.

---

## What this deliberately does not do

- **No account, no password, no e-mail.** One person, their own devices, and a
  code typed once. Adding users would mean adding an authorisation model to a
  server whose entire virtue is that it does not have one.
- **No expiry on the token.** An expiry logs the phone out at the worst possible
  moment — somewhere with no signal — and recovery needs the code, which is on
  the machine you are not holding. Revocation is deleting the row.
- **No brotli in the container.** The build emits `.br` twins and stock nginx
  cannot serve them. `gzip_static` serves the `.gz` twins instead; the
  difference on an 84 kB bundle did not justify maintaining a custom nginx
  image.
- **No full CSP.** The theme is applied by an inline script before first paint,
  so `script-src` would need a hash kept in step by hand — and a policy that
  drifts is a policy that gets switched off. `frame-ancestors`,
  `X-Content-Type-Options`, `Referrer-Policy` and `Strict-Transport-Security`
  are set; they never drift. HSTS lives in the container's `headers.conf`
  rather than the host's file, because certbot rewrites that one and the
  header rides through the proxy untouched.
- **No index, no snippet, no training set.** `static/robots.txt` disallows
  everything and names the AI crawlers that publish an opt-out token of their
  own; `app.html` carries `<meta name="robots" content="noindex, …">` for
  whatever fetched the shell anyway; and `headers.conf` sends `X-Robots-Tag`
  on every response, the API's JSON included. One person's ledger has no
  audience, and a crawler that reached it would only ever see the shell.
- **No monitoring, no metrics, no alerting.** If sync stops, Settings says so on
  the screen of the person who cares.
