/**
 * The 150 kB brotli budget, enforced.
 *
 * `docs/PROJECT-PLAN.md` §13.12 makes every dependency a bundle-size decision.
 * A budget nobody measures is a preference, so this fails the build rather than
 * printing a number into a log nobody opens.
 *
 * It measures the **entry route** specifically — the layout, the root page and
 * everything they import — because that is what a cold launch pays for, and it
 * is the screen the whole five-second argument rests on. A heavy `/settings`
 * costs nothing at launch and is not counted.
 *
 * Run after `pnpm build`.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');
const manifestPath = join(web, '.svelte-kit', 'output', 'client', '.vite', 'manifest.json');

const BUDGET_KB = 150;

if (!existsSync(manifestPath)) {
	console.error('No client manifest. Run `pnpm build` first.');
	process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/**
 * The entry route's roots: SvelteKit's client entry, the app shell, the layout
 * (node 0), the error page (node 1) and the root page (node 2).
 */
const roots = Object.keys(manifest).filter(
	(key) =>
		key.endsWith('/runtime/client/entry.js') ||
		key.endsWith('client-optimized/app.js') ||
		/client-optimized\/nodes\/[012]\.js$/.test(key)
);

if (roots.length === 0) {
	console.error('Could not identify the entry route in the manifest.');
	process.exit(1);
}

const js = new Set();
const css = new Set();

function walk(key, seen = new Set()) {
	if (seen.has(key)) return;
	seen.add(key);
	const entry = manifest[key];
	if (!entry) return;
	js.add(entry.file);
	for (const sheet of entry.css ?? []) css.add(sheet);
	for (const next of entry.imports ?? []) walk(next, seen);
}

const seen = new Set();
for (const root_ of roots) walk(root_, seen);

/** The precompressed sibling the server actually ships. */
function brotliSize(file) {
	const path = join(web, 'build', `${file}.br`);
	return existsSync(path) ? statSync(path).size : 0;
}

const jsBytes = [...js].reduce((total, file) => total + brotliSize(file), 0);
const cssBytes = [...css].reduce((total, file) => total + brotliSize(file), 0);

const jsKb = jsBytes / 1024;
const cssKb = cssBytes / 1024;

console.log(`entry route JS   ${jsKb.toFixed(1)} kB brotli  (${js.size} files)`);
console.log(`entry route CSS  ${cssKb.toFixed(1)} kB brotli  (${css.size} files)`);
console.log(`budget           ${BUDGET_KB} kB (JS)`);

if (jsBytes === 0) {
	console.error('\nMeasured nothing. Is `precompress` still on in vite.config.ts?');
	process.exit(1);
}

if (jsKb > BUDGET_KB) {
	console.error(`\nOver budget by ${(jsKb - BUDGET_KB).toFixed(1)} kB.`);
	console.error('Rule 12: every package is a bundle-size decision. Ask before adding one.');
	process.exit(1);
}

console.log(`\nOK — ${(BUDGET_KB - jsKb).toFixed(1)} kB of headroom.`);
