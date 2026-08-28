<script lang="ts">
	/**
	 * The title bar for a tab destination.
	 *
	 * Once navigation lives in the thumb zone, the top of the screen stops being
	 * a place you reach for and becomes a place you read: this bar says where you
	 * are and nothing else. No back arrow — the tabs are peers, and the way to
	 * the keypad is the disc in the middle of the bar at the bottom.
	 *
	 * `heading` replaces the plain title for a screen that needs a control up
	 * there instead, like the month switcher.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		/** Replaces the title outright. Must contain the screen's own <h1>. */
		heading?: Snippet;
		/** Buttons for the trailing edge. Each one is a 44 px target. */
		trail?: Snippet;
	}

	let { title, heading, trail }: Props = $props();
</script>

<header class="appbar">
	{#if heading}
		{@render heading()}
	{:else}
		<h1 class="appbar__title">{title}</h1>
	{/if}

	{#if trail}
		<div class="appbar__trail">{@render trail()}</div>
	{/if}
</header>

<style>
	.appbar {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: 56px;
		padding: var(--space-2) var(--space-4) var(--space-2);
		padding-top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
	}

	/**
	 * The screen title takes the display treatment — this is the only place on a
	 * phone screen where a heading has room to be one.
	 */
	.appbar__title {
		font-size: var(--text-2xl);
		font-weight: 700;
		letter-spacing: var(--track-display);
		color: var(--ink);
		text-wrap: balance;
	}

	.appbar__trail {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		/* The optical edge is the glyph, not the target box around it. */
		margin-right: calc(var(--space-2) * -1);
	}

	/**
	 * Short screens — a landscape phone, or a browser tab wearing two toolbars.
	 *
	 * The bar is `flex: none`, so every pixel it holds is a pixel the list below
	 * it does not get. On a 400 px-tall screen it gives its air back. The row's
	 * own controls are 44 px targets and stay exactly that.
	 */
	@media (max-height: 560px) {
		.appbar {
			min-height: 48px;
			padding-block: var(--space-1);
			padding-top: calc(var(--space-1) + env(safe-area-inset-top, 0px));
		}

		/* 28 px in a 48 px bar is a title wearing the bar. */
		.appbar__title {
			font-size: var(--text-xl);
			font-weight: 600;
			letter-spacing: var(--track-tight);
		}
	}
</style>
