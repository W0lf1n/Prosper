<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		ondigit: (digit: string) => void;
		oncomma: () => void;
		onbackspace: () => void;
		onclear: () => void;
	}

	let { ondigit, oncomma, onbackspace, onclear }: Props = $props();

	/**
	 * Phone order — 1-2-3 on top, 7-8-9 at the bottom.
	 *
	 * This started as calculator order (7-8-9 on top), on the theory that a sum
	 * is typed on a till. In practice every numeric keyboard the phone itself
	 * shows — including the native one on this app's own amount fields — puts
	 * 1-2-3 on top, and the pad kept losing to that muscle memory
	 * (DECISIONS.md, 2026-09-01).
	 */
	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let clearedByHold = false;

	/**
	 * Hold backspace to wipe the amount — faster than tapping it away.
	 *
	 * The deletion itself hangs off `click`, not `pointerup`, so the key still
	 * works for anyone driving the pad from a keyboard. The pointer handlers only
	 * run the hold timer and, when the hold fires, suppress the click that
	 * follows.
	 */
	function startHold() {
		clearedByHold = false;
		holdTimer = setTimeout(() => {
			clearedByHold = true;
			onclear();
			navigator.vibrate?.(15);
		}, 450);
	}

	function cancelHold() {
		clearTimeout(holdTimer);
	}

	function deleteDigit() {
		clearTimeout(holdTimer);
		if (clearedByHold) {
			clearedByHold = false;
			return;
		}
		onbackspace();
	}
</script>

<div class="keypad">
	{#each keys as key (key)}
		<button type="button" class="key" onclick={() => ondigit(key)}>
			<span class="key__face">{key}</span>
		</button>
	{/each}

	<button type="button" class="key key--aux" onclick={oncomma} aria-label="desetinná čárka">
		<span class="key__face">,</span>
	</button>

	<button type="button" class="key" onclick={() => ondigit('0')}>
		<span class="key__face">0</span>
	</button>

	<button
		type="button"
		class="key key--aux"
		aria-label="smazat číslici, podržením smažeš vše"
		onclick={deleteDigit}
		onpointerdown={startHold}
		onpointerleave={cancelHold}
		onpointercancel={cancelHold}
	>
		<span class="key__face"><Icon name="backspace" size={23} /></span>
	</button>
</div>

<style>
	.keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-2);
	}

	/* On a short screen the gutters between the keys close before the keys do. */
	@media (max-height: 700px) {
		.keypad {
			gap: var(--space-1);
		}
	}

	/* Gutters close further; the keys themselves stay at 44. */
	@media (max-height: 480px) {
		.keypad {
			gap: 2px;
		}
	}

	/**
	 * A key is a physical object: a slab raised out of the pad by one step of
	 * luminance. It is lighter than the pad, and that is the whole elevation —
	 * no contact shadow underneath it.
	 *
	 * Pressing it does two things and no more: the surface darkens one step and
	 * the key scales to 0.95, which is the press contract every button in the
	 * app shares. Ninety milliseconds, because a key that takes longer than that
	 * feels broken.
	 */
	.key {
		display: grid;
		place-items: center;
		/**
		 * `dvh`, so a key sizes against the glass that is actually visible rather
		 * than against a viewport with the address bar counted in twice.
		 *
		 * The floor is `--touch` and the floor is the point. Everything else on
		 * this screen has been drawn down to 32 px and given its 44 px back with
		 * a hit area; a key is the one control you aim at forty times a day, so
		 * it is drawn at the size it is hit at. The slack came out of the ramp
		 * instead — 6.4dvh lands a 640 px phone exactly on 44 rather than 47.
		 */
		min-height: clamp(var(--touch), 6.4dvh, 56px);
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--ink);
		user-select: none;
		box-shadow: var(--edge);
		transition:
			background var(--dur-press) var(--ease-out),
			transform var(--dur-press) var(--ease-out);
	}

	.key__face {
		display: grid;
		place-items: center;
		font-family: var(--font-mono);
		font-size: var(--text-xl);
		font-weight: 400;
		line-height: 1;
		letter-spacing: 0;
	}

	/* One press, one property. The key scales; the glyph inside it no longer
	   scales separately, which was two presses fighting over 90 ms. */
	.key:active {
		background: var(--surface-3);
		transform: scale(0.95);
	}

	/* Auxiliary keys keep the target and the geometry, and give up the material:
	   the pad has ten digits on it, not twelve. */
	.key--aux {
		background: transparent;
		color: var(--ink-3);
		box-shadow: none;
	}

	.key--aux:active {
		background: var(--surface-2);
	}

	@media (hover: hover) {
		.key:hover {
			background: var(--surface-3);
		}

		.key--aux:hover {
			background: var(--surface-2);
			color: var(--ink-2);
		}
	}
</style>
