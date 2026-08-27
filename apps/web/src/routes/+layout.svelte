<script lang="ts">
	import '$lib/styles/app.css';
	import Scenery from '$lib/ui/Scenery.svelte';
	import Toaster from '$lib/ui/Toaster.svelte';
	import { shell } from '$lib/ui/shell.svelte';
	import { initSync, watchTriggers } from '$lib/sync/status.svelte';

	let { children } = $props();

	/**
	 * Sync takes up position once, here, and then gets on with it in the
	 * background (§10.6 — it never blocks the UI).
	 *
	 * `initSync` is a no-op on a device that has never been paired, which is
	 * every device until somebody opens Settings and types a code. The triggers
	 * are the §10.7 set: foreground, and connectivity regained.
	 */
	$effect(() => {
		void initSync();
		return watchTriggers();
	});

	/* Only written when a route has measured its own floor; otherwise the
	   cascade in `app.css` keeps the say. */
	const lift = $derived(
		shell.bottomInset === null ? undefined : `--toast-lift: ${shell.bottomInset}`
	);
</script>

<div class="app" style={lift}>
	{@render children()}
	<Scenery />
	<Toaster />
</div>

<style>
	/**
	 * The frame. A column the height of the *dynamic* viewport: the header and
	 * the bottom bar are `flex: none`, and every screen owns exactly one scroll
	 * region inside it. Nothing can push the keypad or the tabs off the phone —
	 * and nothing that does not fit is silently clipped, because the region it
	 * lives in scrolls.
	 *
	 * `dvh` rather than `vh` so the column tracks the collapsing address bar and
	 * the on-screen keyboard instead of hiding its own bottom edge behind them.
	 * `vh` first, as the fallback for an engine that does not know `dvh`.
	 *
	 * `position: relative` is load-bearing twice over: it lifts the whole app
	 * above the ground's grain layer, and it is the containing block the toast
	 * and the save flash are positioned against, which is what keeps both of
	 * them inside the instrument on a desktop instead of loose in the window.
	 */
	.app {
		position: relative;
		z-index: var(--z-raised);
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		max-width: 34rem;
		margin-inline: auto;
		/* Landscape on a notched phone puts the cutout and the rounded corners on
		   the long edges. Zero on every other device, so this costs nothing. */
		padding-left: env(safe-area-inset-left, 0px);
		padding-right: env(safe-area-inset-right, 0px);
	}

	/**
	 * On a desktop the app is still a phone-shaped column, so it says so: an
	 * edge on both sides turns a stranded strip of UI into a deliberate object
	 * sitting on the ground.
	 */
	@media (min-width: 35rem) {
		.app {
			border-inline: 1px solid var(--hairline);
			box-shadow: var(--elev-2);
		}
	}
</style>
