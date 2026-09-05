<script lang="ts">
	import '$lib/styles/app.css';
	import { liveQuery } from 'dexie';
	import { db } from '$lib/db/schema';
	import { homeCurrency } from '$lib/domain/accounts';
	import type { Account } from '$lib/domain/types';
	import Toaster from '$lib/ui/Toaster.svelte';
	import { applyCurrencyTint, currencyTint, syncThemeColor } from '$lib/ui/tint';
	import { initSync, watchTriggers } from '$lib/sync/status.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	/**
	 * The room takes the colour of the currency being written (Q50).
	 *
	 * Subscribed by hand and assigned into `$state`, because this is the one
	 * component that lives outside every route's scroll region — the place
	 * the `$store` auto-subscription is not to be trusted (`CLAUDE.md`).
	 */
	let accounts = $state<Account[]>([]);
	$effect(
		() =>
			liveQuery(() => db().accounts.toArray()).subscribe((rows) => (accounts = rows as Account[]))
				.unsubscribe
	);

	const tint = $derived.by(() => {
		const active = accounts.find((a) => a.id === data.accountId);
		return currencyTint(active?.currency, homeCurrency(accounts));
	});

	$effect(() => {
		applyCurrencyTint(tint);
	});

	/* The status bar reads the resolved ground, which moves with the system
	   theme even when nothing else does. */
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', syncThemeColor);
		return () => media.removeEventListener('change', syncThemeColor);
	});

	/**
	 * Sync takes up position once, here, and then gets on with it in the
	 * background (§10.6 — it never blocks the UI).
	 */
	$effect(() => {
		void initSync();
		return watchTriggers();
	});

	/**
	 * The launch splash lives in `app.html`, on screen from the first paint.
	 * It plays out in full on every launch — Petr's ask, 2026-08-29 — so the
	 * dismissal waits for its animations to finish rather than racing them.
	 */
	$effect(() => {
		const splash = document.getElementById('splash');
		if (!splash) return;
		const animated = splash.getAnimations({ subtree: true });
		let hold: ReturnType<typeof setTimeout> | undefined;
		let gone: ReturnType<typeof setTimeout> | undefined;
		void Promise.allSettled(animated.map((a) => a.finished)).then(() => {
			hold = setTimeout(
				() => {
					splash.classList.add('splash-out');
					gone = setTimeout(() => splash.remove(), 350);
				},
				animated.length > 0 ? 200 : 0
			);
		});
		return () => {
			clearTimeout(hold);
			clearTimeout(gone);
		};
	});
</script>

<div class="app">
	{@render children()}
	<Toaster />
</div>

<style>
	/**
	 * The frame. A column the height of the *dynamic* viewport: the tab bar is
	 * `flex: none`, and every screen owns exactly one scroll region inside it.
	 * Nothing can push the keypad or the tabs off the phone, and nothing that
	 * does not fit is silently clipped, because the region it lives in scrolls.
	 *
	 * `position: relative` is the containing block the toast is positioned
	 * against, which keeps it inside the phone-shaped column on a desktop.
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
		padding-left: env(safe-area-inset-left, 0px);
		padding-right: env(safe-area-inset-right, 0px);
	}

	/* On a desktop the app is still a phone-shaped column, and it says so. */
	@media (min-width: 35rem) {
		.app {
			border-inline: 1px solid var(--hairline);
		}
	}
</style>
