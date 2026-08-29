# The client, as a container: a static build and one proxy rule.
#
# The build context is the **repository root**, not `apps/web` — the client
# imports `@prosper/contracts`, which is a sibling workspace package, and pnpm
# needs the lockfile at the top to install what CI installed.
#
#     docker build -f apps/web/Dockerfile .

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /src

# Pinned to what CI uses. Corepack would work too, but it wants to prompt about
# downloading a version, and a build that asks a question is a build that hangs.
RUN npm install --global pnpm@9

# Manifests first: editing a Svelte file must not re-run the install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── serve ───────────────────────────────────────────────────────────────────
# nginx rather than a Node process. There is no server-side anything to run:
# the ledger lives in IndexedDB, `adapter-static` emits files, and this image is
# a file server with one `location /api/`.
# The stable branch, not mainline: mainline tags stop receiving fixes the
# moment the next branch opens, and nobody rebuilds this image often enough
# to chase that.
FROM nginx:1.28-alpine

COPY deploy/nginx/headers.conf /etc/nginx/snippets/headers.conf
COPY deploy/nginx/app.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/build /usr/share/nginx/html

# Answers on 80 inside the compose network. Nothing publishes it to the world —
# the host's nginx terminates TLS and proxies to the one published port.
EXPOSE 80

# `wget` here is busybox's, not GNU's: it has `-q` and `-O` and does not know
# `--tries`, which it would reject as an unrecognised option — leaving the
# container permanently unhealthy for a reason that never appears in a log.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD wget -q -O /dev/null http://localhost/200.html || exit 1
