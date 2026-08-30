<script lang="ts">
	import { formatMoney } from '$lib/domain/money';
	import Icon from './Icon.svelte';
	import { toast } from './toast.svelte';

	async function undo() {
		const action = toast.current?.undo;
		toast.dismiss();
		await action?.();
	}
</script>

{#if toast.current}
	{@const t = toast.current}
	{#key t.id}
		<div class="wrap" role="status" aria-live="polite">
			<!--
			  Tapping the card puts it away. Nothing on this screen wants to wait
			  three seconds for its own confirmation to get out of the way, and a
			  close button would be a fourth thing to aim at on a card whose whole
			  job is to be read and forgotten.
			-->
			<div
				class="toast tone-{t.tone}"
				class:toast--money={t.amount !== undefined}
				style="--toast-life: {t.ms}ms"
				role="presentation"
				onclick={toast.dismiss}
			>
				{#if t.amount !== undefined}
					<!-- Money: the amount is the message. -->
					<span class="arrow">
						<Icon name={t.amount < 0 ? 'arrow-down' : 'arrow-up'} size={19} stroke={2.2} />
					</span>

					<span class="body">
						<span class="amount">{formatMoney(t.amount, { sign: 'never', code: t.code })}</span>
						{#if t.message}
							<span class="note">{t.message}</span>
						{/if}
					</span>
				{:else}
					<span class="plain__text">{t.message}</span>
				{/if}

				{#if t.undo}
					<button
						type="button"
						class="undo"
						class:undo--plain={t.amount === undefined}
						onclick={(event) => {
							event.stopPropagation();
							void undo();
						}}
					>
						Zpět
					</button>
				{/if}

				<!-- The lifetime, running out along the bottom edge. -->
				<span class="fuse" aria-hidden="true"></span>
			</div>
		</div>
	{/key}
{/if}

<style>
	/**
	 * Above the floor, never on it.
	 *
	 * The toast used to sit `--space-5` off the bottom of the window, which on
	 * the entry screen is three hundred pixels *inside* the keypad: every
	 * confirmation landed squarely on the Uložit button that produced it, and on
	 * a short screen it took the amount down with it. So the offset is not a
	 * taste value any more, it is the height of whatever the route has parked
	 * down there — the tab bar on a tab screen, the measured keypad on the entry
	 * screen — and the card rests on top of that floor like a receipt on a
	 * counter.
	 *
	 * The `min()` is the floor under the floor. On a landscape phone the keypad
	 * is most of the glass, and clearing it completely would push the card off
	 * the top edge; past that point it is allowed to overlap, because a
	 * confirmation covering a key beats a confirmation nobody sees.
	 *
	 * Absolute rather than fixed, because it belongs to the app column — which
	 * on a desktop is 34 rem of instrument in the middle of a wide window, not
	 * the window.
	 */
	.wrap {
		position: absolute;
		left: 50%;
		bottom: min(
			calc(var(--toast-lift, var(--space-5)) + env(safe-area-inset-bottom, 0px)),
			calc(100% - 7rem - env(safe-area-inset-top, 0px))
		);
		transform: translateX(-50%);
		z-index: var(--z-toast);
		width: calc(100% - var(--space-4) * 2);
		max-width: 26rem;
		pointer-events: none;
	}

	.wrap > * {
		pointer-events: auto;
	}

	/**
	 * The toast lands.
	 *
	 * It is the confirmation for the one action this app exists to perform, so it
	 * arrives with weight rather than fading in: up from the keypad it was saved
	 * on, on a hard deceleration, and the disc carrying the direction lands a
	 * beat later. No overshoot anywhere — a bounce would make it a toy.
	 */
	.toast {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		overflow: hidden;
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		box-shadow: var(--edge), var(--elev-3);
		animation: land var(--dur-slow) var(--ease-settle);
	}

	/**
	 * The confirmation carries the direction in its ground, the same way the
	 * entry screen's amount does — so the answer to "did that go out or come
	 * in?" arrives before the minus sign has been read.
	 *
	 * It is a wash and it stays one: eight per cent of the hue mixed into the
	 * surface, with the border a step firmer so the card still has an edge. The
	 * amount itself keeps the palette's own rule — colourless going out, signal
	 * coming in — and never competes with the ground behind it.
	 */
	.tone-out {
		--tone: var(--ink);
		--tone-wash: var(--surface-3);
		--fuse-ink: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, var(--surface));
		border-color: color-mix(in srgb, var(--danger) 28%, var(--hairline));
	}

	.tone-in {
		--tone: var(--in);
		--tone-wash: var(--in-wash);
		--fuse-ink: var(--in);
		background: color-mix(in srgb, var(--in) 8%, var(--surface));
		border-color: color-mix(in srgb, var(--in) 28%, var(--hairline));
	}

	.tone-flag {
		--tone: var(--flag);
		--tone-wash: var(--flag-wash);
		--fuse-ink: var(--flag);
	}

	.tone-neutral {
		--tone: var(--ink-2);
		--tone-wash: var(--surface-2);
		--fuse-ink: var(--ink-3);
	}

	/* ── money ───────────────────────────────────────────────────────────── */

	.arrow {
		display: grid;
		place-items: center;
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		background: var(--tone-wash);
		color: var(--tone);
		animation: nudge var(--dur-base) var(--ease-settle) 70ms both;
	}

	.body {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}

	.amount {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-2xl);
		font-weight: 600;
		line-height: var(--leading-tight);
		letter-spacing: -0.035em;
		color: var(--tone);
	}

	.note {
		font-size: var(--text-xs);
		color: var(--ink-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.undo {
		flex: none;
		min-height: var(--touch);
		padding-inline: var(--space-4);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.undo:active {
		transform: scale(0.96);
		background: var(--surface-3);
		color: var(--ink);
	}

	@media (hover: hover) {
		.undo:hover {
			background: var(--surface-3);
			color: var(--ink);
		}
	}

	/* ── plain ───────────────────────────────────────────────────────────── */

	.toast:not(.toast--money) {
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
		font-size: var(--text-md);
		line-height: var(--leading-snug);
		color: var(--tone);
	}

	.plain__text {
		flex: 1;
		min-width: 0;
	}

	.undo--plain {
		min-height: 38px;
	}

	/**
	 * The fuse.
	 *
	 * A toast with an undo is a promise with an expiry, and every version of
	 * this card so far kept the expiry to itself: six seconds of "Zpět" looked
	 * exactly like six hundred. One hairline along the bottom edge, in the
	 * direction's own hue, running down over the toast's real lifetime — the
	 * duration comes off the toast itself, so the number is never written twice.
	 *
	 * `transform` on a full-width bar, so the countdown is composited and the
	 * card never lays out again while it is on screen.
	 */
	.fuse {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 2px;
		background: var(--fuse-ink);
		opacity: 0.5;
		transform-origin: left center;
		animation: burn var(--toast-life, 3000ms) linear both;
	}

	@keyframes burn {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}

	@keyframes land {
		0% {
			opacity: 0;
			transform: translateY(20px) scale(0.97);
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes nudge {
		0% {
			transform: scale(0.6);
			opacity: 0;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	/* A countdown that finishes instantly is a bar that was never there — but
	   hiding it entirely left the undo's expiry with no signal at all. Held
	   static at half-burnt, it still says "this offer runs out" without
	   animating anything. */
	@media (prefers-reduced-motion: reduce) {
		.fuse {
			animation: none;
			transform: scaleX(0.5);
		}
	}
</style>
