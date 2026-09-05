#!/bin/bash
# Nightly dump of the sync database — `PROJECT-PLAN.md` §14.
#
#     sudo crontab -e
#     17 3 * * *  /srv/prosper/deploy/backup.sh >> /var/log/prosper-backup.log 2>&1
#
# **This is the second copy, not the first.** The first copy of the ledger is
# IndexedDB on the phone, and the JSON export in Settings is the one backup that
# has actually been restored from. This protects against losing the VPS, which
# is a different risk and a real one.
#
# It is deliberately dull: pg_dump, gzip, delete what is older than KEEP_DAYS.
# No incremental anything. The database is one person's transactions — the whole
# thing compresses to less than a photograph.

# `pipefail` is why this is bash and not sh: without it the `pg_dump | gzip`
# below exits on gzip's status, and gzip succeeds at compressing an error.
# dash — which is `/bin/sh` on Debian — does not have it.
set -euo pipefail

# The dump is the whole ledger in plain text. Nothing on the box but root has
# any business reading it, so every file this writes is created 0600 and the
# directory 0700 — set here rather than left to cron's umask, which is 022 and
# would make the backup the one world-readable copy of everything.
umask 077

# Where this script lives, so cron does not need a working directory.
DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"

DEST="${PROSPER_BACKUP_DIR:-/var/backups/prosper}"
KEEP_DAYS="${PROSPER_BACKUP_KEEP_DAYS:-30}"

STAMP="$(date +%Y-%m-%d)"
FILE="$DEST/prosper-$STAMP.sql.gz"

mkdir -p "$DEST"
# A directory that already existed was created under the old umask.
chmod 700 "$DEST"

# `-T` because cron has no TTY and `exec` allocates one by default — which is
# how this works by hand and fails at 03:17 every night. `-f` as well as
# `--project-directory` so it does not matter what compose would have guessed.
docker compose \
	-f "$DEPLOY_DIR/docker-compose.yml" \
	--project-directory "$DEPLOY_DIR" \
	exec -T db pg_dump --username prosper --clean --if-exists prosper |
	gzip -9 >"$FILE.partial"

# Renamed only once it is whole. A truncated dump that looks like a backup is
# worse than no backup, because it is the one you reach for.
mv "$FILE.partial" "$FILE"

# An empty dump is a failure that exited 0 — an unreadable database still
# produces a valid, tiny gzip stream.
SIZE="$(wc -c <"$FILE")"
if [ "$SIZE" -lt 1024 ]; then
	echo "$(date -Iseconds) FAILED: $FILE is $SIZE bytes" >&2
	exit 1
fi

find "$DEST" -name 'prosper-*.sql.gz' -mtime "+$KEEP_DAYS" -delete

echo "$(date -Iseconds) ok: $FILE ($SIZE bytes)"

# Restoring, for when it is needed and nobody remembers:
#
#     gunzip -c /var/backups/prosper/prosper-2026-08-27.sql.gz \
#       | docker compose exec -T db psql --username prosper prosper
#
# Do it once, on purpose, before you need it. A backup nobody has restored from
# is a hypothesis.
