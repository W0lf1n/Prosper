#!/bin/sh
# The deployment as one command: what `DEPLOYMENT.md` › Updating does by hand,
# made safe to run unattended.
#
#     sudo /opt/prosper/deploy/deploy.sh <commit>
#
# Runs as root, because compose does. In normal use it is called by
# `prosper-deploy`, the forced command on the GitHub Actions key, and it is the
# only thing the `prosper-deploy` account may run as root (the sudoers line in
# `DEPLOYMENT.md`). A person on the box can run it too, and should, instead of
# the four-command dance.
#
# The argument is the commit to deploy: forty hex digits, or `master` for the
# newest one. It has to be on `origin/master` already. A commit that lives only
# on a branch, or one somebody made up, is refused. That is the whole
# authorisation model: the key can ask for any commit, but only for one that
# has been pushed to master and has passed CI there.
set -eu

ROOT=${PROSPER_ROOT:-/opt/prosper}
WANT=${1:-master}

log() { printf '%s deploy: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"; }
die() { log "$*" >&2; exit 1; }

cd "$ROOT" || die "$ROOT is not there"
[ -f deploy/.env ] || die "deploy/.env is missing (DEPLOYMENT.md, step 2)"

# Where the app answers on the host; the health check below asks it there.
PORT=$(sed -n 's/^PROSPER_PORT=//p' deploy/.env | tail -n1)
PORT=${PORT:-8080}

# ── which commit ────────────────────────────────────────────────────────────
log "fetching origin/master"
git fetch --quiet --prune origin master

if [ "$WANT" = master ]; then
	SHA=$(git rev-parse origin/master)
else
	case $WANT in
		*[!0-9a-f]*) die "refused: $WANT is not a commit" ;;
	esac
	[ ${#WANT} -eq 40 ] || die "refused: $WANT is not a full commit id"
	SHA=$(git rev-parse --verify --quiet "$WANT^{commit}") || die "refused: $WANT is not a commit here"
	git merge-base --is-ancestor "$SHA" origin/master || die "refused: $SHA is not on origin/master"
fi

BEFORE=$(git rev-parse HEAD)
log "deploying $SHA (was $BEFORE)"

# `reset --hard` rather than `pull`: a pull merges, and a merge is a decision
# this script must never make. Untracked files, meaning `deploy/.env`, survive.
git checkout --quiet --force master
git reset --quiet --hard "$SHA"

# ── build and start ─────────────────────────────────────────────────────────
# `--pull` refreshes the base images; without it, security patches never
# arrive. The API is recreated before the client (`depends_on`), which is the
# order Q69 requires: a new client must never talk to an old server.
cd deploy
log "building images"
docker compose build --pull --quiet
log "starting containers"
docker compose up -d --remove-orphans --quiet-pull

# ── prove it ────────────────────────────────────────────────────────────────
# The web container proxies /api/ to the API, so one request checks that the
# static build is served, the proxy matches, and the API is up. Thirty seconds
# is the API's cold start on a 1 vCPU box, with room.
HEALTH="http://127.0.0.1:$PORT/api/v1/health"
i=0
until BODY=$(curl -fsS --max-time 3 "$HEALTH" 2>/dev/null); do
	i=$((i + 1))
	if [ "$i" -ge 30 ]; then
		docker compose ps
		docker compose logs --tail=40 api web
		die "$HEALTH did not answer within 30 s; the logs above say why"
	fi
	sleep 1
done
log "health: $BODY"

# Layers orphaned by the build just replaced, and nothing that is in use.
docker image prune -f --filter 'dangling=true' >/dev/null

log "deployed $SHA"
