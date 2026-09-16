/**
 * Is this build the demo? — DECISIONS Q74.
 *
 * `VITE_DEMO=1` at build time, and nothing else: no hostname check, no file
 * fetched at boot. `vite.config.ts` folds it into the literal `__DEMO__`, so
 * the demo is a separate image (`deploy/docker-compose.demo.yml`) and the real
 * app cannot become the demo by being opened from the wrong address. The real
 * build keeps the guarded template strings and an unfetched seeder chunk;
 * nothing behind the flag runs there, and nothing is downloaded for it.
 *
 * What it changes: the app opens on the sample ledger, Začít znovu empties
 * every table and comes back to it, Domů wears a badge, and the sync room is
 * not listed — there is no server behind the demo to pair with.
 */
export const IS_DEMO: boolean = __DEMO__;
