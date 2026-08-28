<script lang="ts">
	/**
	 * The bottom navigation.
	 *
	 * Destinations belong in the thumb zone. Every other screen in this app is
	 * something you read, and reading happens with the phone held low — reaching
	 * to the top-right corner for a back arrow is the one thing a phone is worst
	 * at.
	 *
	 * The entry screen deliberately does NOT carry this bar: there the keypad
	 * owns the bottom of the phone, and it needs every pixel it can get on a
	 * short screen. The bar's centre disc is how you get back to it, which makes
	 * recording a transaction one tap away from anywhere in the app.
	 *
	 * It is a flex child of the app column rather than a fixed overlay, so it
	 * cannot cover a row, and no screen has to reserve padding for it.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from './Icon.svelte';

	const entry = resolve('/');

	/**
	 * Route ids rather than resolved hrefs: `resolve()` is called at each `href`
	 * so the link checker can see it, and so a renamed route fails the build here
	 * instead of at the tap.
	 */
	type Destination = '/tape' | '/mesic' | '/platby' | '/cil' | '/jmeni' | '/settings';

	/**
	 * Six, three each side of the disc — up from four on 2026-08-28, when
	 * Pravidelné platby became a screen of its own and Jmění was asked for down
	 * here rather than only in the corner of the entry screen.
	 *
	 * Six is the ceiling and this is at it: seven cells on a 320 px phone give
	 * each label 38 px, which is where a Czech word stops fitting and starts
	 * being an ellipsis. The labels below are all short for that reason, and the
	 * one long one shrinks a step on a narrow screen rather than being cut.
	 */
	const tabs: { path: Destination; label: string; icon: IconName }[] = [
		{ path: '/tape', label: 'Výpis', icon: 'tape' },
		{ path: '/mesic', label: 'Měsíc', icon: 'month' },
		{ path: '/platby', label: 'Platby', icon: 'repeat' },
		{ path: '/cil', label: 'Cíl', icon: 'goal' },
		{ path: '/jmeni', label: 'Jmění', icon: 'wealth' },
		{ path: '/settings', label: 'Nastavení', icon: 'settings' }
	];

	/** Trailing slashes vary by adapter; compare on the trimmed path. */
	const here = $derived(page.url.pathname.replace(/\/+$/, '') || '/');

	function isCurrent(path: Destination): boolean {
		return here === (resolve(path).replace(/\/+$/, '') || '/');
	}
</script>

<nav class="tabbar" aria-label="Hlavní navigace">
	{#each tabs.slice(0, 3) as tab (tab.path)}
		<a
			class="tab"
			class:tab--on={isCurrent(tab.path)}
			href={resolve(tab.path)}
			aria-current={isCurrent(tab.path) ? 'page' : undefined}
		>
			<span class="tab__glyph"><Icon name={tab.icon} size={21} /></span>
			<span class="tab__label">{tab.label}</span>
		</a>
	{/each}

	<a class="record" href={entry} aria-label="Zapsat částku">
		<span class="record__disc"><Icon name="plus" size={24} stroke={2} /></span>
	</a>

	{#each tabs.slice(3) as tab (tab.path)}
		<a
			class="tab"
			class:tab--on={isCurrent(tab.path)}
			href={resolve(tab.path)}
			aria-current={isCurrent(tab.path) ? 'page' : undefined}
		>
			<span class="tab__glyph"><Icon name={tab.icon} size={21} /></span>
			<span class="tab__label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.tabbar {
		flex: none;
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		align-items: stretch;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		background: var(--surface);
		border-top: 1px solid var(--hairline);
		/* The bar is furniture, not a floating layer: surface luminance and one
		   hairline are the whole separation. */
		box-shadow: var(--edge);
	}

	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		min-width: 0;
		min-height: var(--tabbar);
		padding-block: var(--space-2);
		/* Seven cells across a 320 px phone: every pixel of inline padding is a
		   pixel the label does not get. */
		padding-inline: 1px;
		color: var(--ink-3);
		text-decoration: none;
		transition: color var(--dur-fast) var(--ease-out);
	}

	/* The wash pill is the current-page indicator: it moves, so it is read as
	   position rather than as decoration. */
	.tab__glyph {
		display: grid;
		place-items: center;
		width: 40px;
		height: 26px;
		border-radius: var(--radius-full);
		transition:
			background var(--dur-base) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	/**
	 * One line, always. A label that wraps on a 320 px phone takes the whole row
	 * with it — the tallest cell sets the height of the bar. It shortens
	 * instead.
	 */
	.tab__label {
		max-width: 100%;
		font-size: var(--text-2xs);
		font-weight: 400;
		letter-spacing: 0.005em;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/**
	 * Under 400 px the six cells stop being able to hold "Nastavení" at 11 px.
	 * A step down in size keeps the whole word, and a whole word is worth more
	 * here than a consistent type scale: the alternative is `Nastav…`, which is
	 * not a label.
	 */
	@media (max-width: 400px) {
		.tab__label {
			font-size: 0.625rem; /* 10 */
			letter-spacing: 0;
		}

		.tab__glyph {
			width: 34px;
		}
	}

	.tab--on {
		color: var(--signal);
	}

	.tab--on .tab__glyph {
		background: var(--signal-wash);
	}

	.tab--on .tab__label {
		font-weight: 600;
	}

	/* The press contract: scale(0.95), everywhere, one number. */
	.tab:active .tab__glyph {
		transform: scale(0.95);
	}

	@media (hover: hover) {
		.tab:hover {
			color: var(--ink-2);
		}

		.tab--on:hover {
			color: var(--signal);
		}
	}

	/* ── the primary action ──────────────────────────────────────────────
	   Recording a transaction is what the app is for, so it is never more than
	   one tap away, and it is the only filled shape in the bar. */

	.record {
		display: grid;
		place-items: center;
		min-height: var(--tabbar);
		text-decoration: none;
	}

	.record__disc {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border-radius: var(--radius-full);
		background: var(--signal);
		color: var(--signal-ink);
		/* Flat. It is already the only filled shape in the bar and the only
		   pill-round thing on the screen; a glow on top of that says it twice. */
		transition: transform var(--dur-press) var(--ease-out);
	}

	.record:active .record__disc {
		transform: scale(0.95);
	}

	@media (hover: hover) {
		.record:hover .record__disc {
			filter: brightness(1.06);
		}
	}
</style>
