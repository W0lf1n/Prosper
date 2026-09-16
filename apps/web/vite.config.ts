import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// `VITE_DEMO=1` in the build's environment makes the demo (Q74). Folded into
	// a literal here rather than read as `import.meta.env.VITE_DEMO`, so the
	// flag is a constant and not a lookup. The real build still carries the
	// demo's template strings and an unfetched seeder chunk — Svelte hoists a
	// template whatever guards it — but nothing behind the flag ever runs or
	// is downloaded, and the entry route's budget does not move.
	define: {
		__DEMO__: JSON.stringify(process.env.VITE_DEMO === '1')
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Static output: an app shell plus assets, served by any web server.
			// There is no server-side anything — the ledger lives in IndexedDB.
			adapter: adapter({ fallback: '200.html', precompress: true })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
