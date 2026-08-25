<script lang="ts">
	import { scene } from './scene.svelte';
</script>

{#if scene.current}
	{@const flash = scene.current}
	{#key flash.id}
		<div class="scenery scenery--{flash.direction}" aria-hidden="true">
			<span class="scenery__wash"></span>
			<span class="scenery__rim"></span>
		</div>
	{/key}
{/if}

<style>
	/**
	 * Absolute inside the app column, not fixed to the window.
	 *
	 * On a phone the two are the same rectangle. On a desktop the app is a
	 * 34 rem instrument sitting on a ground, and lighting up the whole browser
	 * window because a row was saved inside that instrument would be a lie
	 * about where the event happened. `.app` clips its own overflow, so the
	 * wash stops at the column's edges without a mask.
	 */
	.scenery {
		position: absolute;
		inset: 0;
		z-index: var(--z-scenery);
		pointer-events: none;
		overflow: hidden;
	}

	.scenery__wash,
	.scenery__rim {
		position: absolute;
		inset: 0;
		display: block;
		opacity: 0;
		will-change: transform, opacity;
	}

	/**
	 * ── going out ───────────────────────────────────────────────────────
	 *
	 * The colour arrives at the top, sinks, and leaves through the bottom of
	 * the phone. Nothing bounces and nothing lands: the point of the gesture
	 * is that it does not stay.
	 */
	.scenery--out .scenery__wash {
		background: radial-gradient(
			126% 62% at 50% -4%,
			color-mix(in srgb, var(--danger) 30%, transparent) 0%,
			color-mix(in srgb, var(--danger) 12%, transparent) 42%,
			transparent 76%
		);
		animation: drain 700ms var(--ease-out) both;
	}

	/**
	 * ── coming in ───────────────────────────────────────────────────────
	 *
	 * The mirror, and one beat slower: arriving is worth more attention than
	 * spending, and it is the rarer of the two events by a factor of thirty.
	 */
	.scenery--in .scenery__wash {
		background: radial-gradient(
			126% 62% at 50% 104%,
			color-mix(in srgb, var(--in) 32%, transparent) 0%,
			color-mix(in srgb, var(--in) 13%, transparent) 42%,
			transparent 76%
		);
		animation: rise 780ms var(--ease-out) both;
	}

	/**
	 * The rim: the glass edge catching the light for a moment.
	 *
	 * It is what keeps the middle of the screen legible. An inset ring plus a
	 * short inward bleed says "the whole surface reacted" without putting a
	 * single per cent of hue over the digits.
	 */
	.scenery__rim {
		animation: ignite 620ms var(--ease-out) both;
	}

	.scenery--out .scenery__rim {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--danger) 55%, transparent),
			inset 0 0 44px -10px color-mix(in srgb, var(--danger) 70%, transparent);
	}

	.scenery--in .scenery__rim {
		box-shadow:
			inset 0 0 0 1px color-mix(in srgb, var(--in) 55%, transparent),
			inset 0 0 44px -10px color-mix(in srgb, var(--in) 70%, transparent);
	}

	@keyframes drain {
		0% {
			opacity: 0;
			transform: translateY(-7%);
		}
		16% {
			opacity: 1;
			transform: translateY(0);
		}
		100% {
			opacity: 0;
			transform: translateY(30%);
		}
	}

	@keyframes rise {
		0% {
			opacity: 0;
			transform: translateY(12%);
		}
		18% {
			opacity: 1;
			transform: translateY(0);
		}
		100% {
			opacity: 0;
			transform: translateY(-10%);
		}
	}

	@keyframes ignite {
		0% {
			opacity: 0;
		}
		14% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/**
	 * Motion off: the fact still has to land, so the wash holds still and simply
	 * shows up. The component unmounts on its own timer either way.
	 */
	@media (prefers-reduced-motion: reduce) {
		.scenery__wash {
			animation: none;
			opacity: 0.75;
		}

		.scenery__rim {
			animation: none;
			opacity: 1;
		}
	}
</style>
