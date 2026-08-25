<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatMonthHeading } from '$lib/domain/datetime';
	import type { Minor } from '$lib/domain/money';
	import Icon from './Icon.svelte';
	import Money from './Money.svelte';

	interface Props {
		month: string; // YYYY-MM
		income: Minor;
		outflow: Minor; // negative
		net: Minor;
		/** Wraps the numbers in a link when given. */
		href?: string;
		/** Buttons for the top-right corner. */
		actions?: Snippet;
		/**
		 * Sits below a rule inside the same slab. The goal strip lives here rather
		 * than in a slab of its own: on a short phone the entry screen has no
		 * vertical room to spare, and the month and the target are one thought.
		 */
		footer?: Snippet;
	}

	let { month, income, outflow, net, href, actions, footer }: Props = $props();

	/**
	 * The two legs, drawn against each other.
	 *
	 * Both bars are scaled to whichever leg is larger, so the comparison is made
	 * by the eye: an outflow bar longer than the income bar is the month running
	 * at a loss, and it says so before the minus sign in front of the total has
	 * been read. The floor of 1 keeps an empty month from dividing by zero.
	 */
	const span = $derived(Math.max(income, Math.abs(outflow), 1));
	const incomeWidth = $derived(Math.round((income / span) * 100));
	const outflowWidth = $derived(Math.round((Math.abs(outflow) / span) * 100));
</script>

<section class="totals">
	<header class="totals__head">
		<h2 class="totals__month u-label">{formatMonthHeading(`${month}-01`)}</h2>
		{#if actions}
			<div class="totals__actions">{@render actions()}</div>
		{/if}
	</header>

	<svelte:element
		this={href ? 'a' : 'div'}
		href={href ?? undefined}
		class="totals__body"
		class:totals__body--link={Boolean(href)}
	>
		<div class="totals__net">
			<Money value={net} size="2xl" bold />
			<span class="totals__caption">zůstatek měsíce</span>
		</div>

		<div class="totals__legs">
			<div class="leg">
				<span class="leg__head">
					<span class="leg__glyph leg__glyph--in"
						><Icon name="arrow-up" size={12} stroke={2.4} /></span
					>
					<Money value={income} size="sm" currency={false} colour={false} />
				</span>
				<span class="leg__meter">
					<span class="leg__fill leg__fill--in" style="width: {incomeWidth}%"></span>
				</span>
			</div>

			<div class="leg">
				<span class="leg__head">
					<span class="leg__glyph leg__glyph--out"
						><Icon name="arrow-down" size={12} stroke={2.4} /></span
					>
					<Money value={outflow} size="sm" currency={false} sign="never" colour={false} />
				</span>
				<span class="leg__meter">
					<span class="leg__fill leg__fill--out" style="width: {outflowWidth}%"></span>
				</span>
			</div>
		</div>
	</svelte:element>

	{#if footer}
		<hr class="perforation totals__rule" />
		{@render footer()}
	{/if}
</section>

<style>
	.totals {
		flex: none;
		margin: var(--space-3) var(--space-3) 0;
		margin-top: calc(var(--space-3) + env(safe-area-inset-top, 0px));
		padding: var(--space-3) var(--space-4) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-lg);
		box-shadow: var(--edge), var(--elev-1);
	}

	.totals__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 28px;
	}

	.totals__month {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.totals__actions {
		display: flex;
		gap: var(--space-1);
		/* Pull the targets out to the slab's optical edge without moving the glyphs. */
		margin: calc(var(--space-2) * -1) calc(var(--space-3) * -1) calc(var(--space-2) * -1) 0;
	}

	.totals__body {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-4);
		margin-top: var(--space-2);
		text-decoration: none;
		color: inherit;
	}

	/* When the totals are a link to the month, the whole block is the target. */
	.totals__body--link {
		min-height: var(--touch);
	}

	.totals__net {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.totals__caption {
		font-size: var(--text-2xs);
		color: var(--ink-3);
		letter-spacing: 0.01em;
	}

	.totals__legs {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		flex: 0 1 8.5rem;
		min-width: 6rem;
		padding-bottom: 2px;
	}

	.leg {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.leg__head {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1);
		color: var(--ink-2);
	}

	.leg__glyph {
		display: grid;
		place-items: center;
	}

	.leg__glyph--in {
		color: var(--in);
	}

	.leg__glyph--out {
		color: var(--ink-3);
	}

	/* Hairline meters. Four pixels of information, and the only chart on the
	   screen you never have to look at directly. */
	.leg__meter {
		height: 3px;
		border-radius: var(--radius-full);
		background: var(--surface-3);
		overflow: hidden;
	}

	.leg__fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-full);
		/* Width, not `scaleX`: these are pill-shaped, and scaling one horizontally
		   squashes the radius on its end into an ellipse. They animate once, when
		   the figures load or change, so there is no layout cost worth the
		   distortion. */
		transition: width var(--dur-slow) var(--ease-out);
	}

	.leg__fill--in {
		background: var(--in);
	}

	.leg__fill--out {
		background: var(--ink-3);
	}

	.totals__rule {
		margin: var(--space-3) calc(var(--space-4) * -1) 0;
	}

	@media (hover: hover) {
		.totals__body--link:hover .totals__caption {
			color: var(--ink-2);
		}
	}

	/**
	 * Short screens: the keypad stays above the fold, so the air goes first and
	 * the meters go with it. The two totals stay — they are the reason the slab
	 * is on this screen at all.
	 */
	@media (max-height: 860px) {
		.totals {
			margin-top: calc(var(--space-2) + env(safe-area-inset-top, 0px));
			padding-top: var(--space-2);
			padding-bottom: var(--space-3);
		}

		/**
		 * The head is as tall as the 44 px icon targets inside it, pulled back by
		 * the negative margin on `.totals__actions`. Widening that pull shortens
		 * the row without touching the targets: they still measure 44, they just
		 * overlap the slab's own padding by more.
		 */
		.totals__head {
			min-height: 20px;
		}

		.totals__actions {
			margin-block: -10px;
		}

		/**
		 * Both of these are full-width row links — 302 px wide — so a shorter box
		 * is still an easy thing to hit. The height they give up is height the
		 * amount below the slab gets back.
		 */
		.totals__body--link {
			min-height: 40px;
		}

		.totals__body {
			margin-top: var(--space-1);
		}

		.leg__meter {
			display: none;
		}

		.totals__legs {
			gap: var(--space-1);
		}

		.totals__rule {
			margin-top: var(--space-2);
		}
	}

	/* Very short: the net drops a step so the amount below it need not. */
	@media (max-height: 700px) {
		.totals {
			padding-top: var(--space-1);
			padding-bottom: var(--space-1);
		}

		.totals__net :global(.size-2xl) {
			font-size: var(--text-xl);
		}

		.totals__caption {
			display: none;
		}
	}
</style>
