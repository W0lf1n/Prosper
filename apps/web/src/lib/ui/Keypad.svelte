<script lang="ts">
	import Icon from './Icon.svelte';
	import { haptic, vibrates } from './haptics';

	interface Props {
		ondigit: (digit: string) => void;
		oncomma: () => void;
		onbackspace: () => void;
		onclear: () => void;
	}

	let { ondigit, oncomma, onbackspace, onclear }: Props = $props();

	/**
	 * Phone order — 1-2-3 on top, 7-8-9 at the bottom. Every numeric keyboard
	 * the phone itself shows puts 1-2-3 on top, and the pad kept losing to that
	 * muscle memory (DECISIONS.md, 2026-09-01).
	 */
	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

	/**
	 * A key registers when the thumb lands, not on `click` — the way the
	 * phone's own keyboard does. A `click` needs one finger down and up on the
	 * same spot: a second thumb landing before the first lifts produces none at
	 * all, and a thumb that drifts a few pixels is taken for a pan and the click
	 * is cancelled. Typed fast, the pad dropped digits (Q77).
	 *
	 * `click` stays for what has no pointer — Enter, Space, a screen reader —
	 * and is ignored when it is only the echo of a press already counted.
	 */
	let lastPointer = -Infinity;
	const ECHO_MS = 800;

	function press(event: PointerEvent, action: () => void) {
		if (event.button !== 0) return;
		lastPointer = event.timeStamp;
		// Android ticks on the way down. iOS only honours the tick from an
		// event that counts as activation, and for a finger that is the lift.
		if (vibrates) haptic();
		action();
	}

	function release(event: PointerEvent) {
		lastPointer = event.timeStamp;
		if (!vibrates) haptic();
	}

	function click(event: MouseEvent, action: () => void) {
		if (event.timeStamp - lastPointer < ECHO_MS) return;
		haptic();
		action();
	}

	let holdTimer: ReturnType<typeof setTimeout> | undefined;

	/** Hold backspace to wipe the amount — faster than tapping it away. */
	function startHold() {
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			onclear();
			haptic(15);
		}, 450);
	}

	function cancelHold() {
		clearTimeout(holdTimer);
	}
</script>

<div class="keypad">
	{#each keys as key (key)}
		<button
			type="button"
			class="key"
			onpointerdown={(e) => press(e, () => ondigit(key))}
			onpointerup={release}
			onclick={(e) => click(e, () => ondigit(key))}
		>
			{key}
		</button>
	{/each}

	<button
		type="button"
		class="key"
		aria-label="desetinná čárka"
		onpointerdown={(e) => press(e, oncomma)}
		onpointerup={release}
		onclick={(e) => click(e, oncomma)}
	>
		,
	</button>

	<button
		type="button"
		class="key"
		onpointerdown={(e) => press(e, () => ondigit('0'))}
		onpointerup={release}
		onclick={(e) => click(e, () => ondigit('0'))}
	>
		0
	</button>

	<button
		type="button"
		class="key"
		aria-label="smazat číslici, podržením smažeš vše"
		onpointerdown={(e) => {
			press(e, onbackspace);
			if (e.button === 0) startHold();
		}}
		onpointerup={(e) => {
			cancelHold();
			release(e);
		}}
		onpointerleave={cancelHold}
		onpointercancel={cancelHold}
		onclick={(e) => click(e, onbackspace)}
	>
		<Icon name="backspace" size={24} stroke={1.8} />
	</button>
</div>

<style>
	.keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
		/* A thumb that slides while typing is typing, not panning. */
		touch-action: none;
	}

	/**
	 * A key is bare — transparent on the ground, over the glow in the dark —
	 * and lights up to the soft surface under the thumb. 56 px tall on a phone
	 * with the room; never under 44.
	 */
	.key {
		position: relative;
		display: grid;
		place-items: center;
		min-height: clamp(var(--touch), 6.4dvh, var(--key));
		border-radius: var(--radius-sm);
		color: var(--ink);
		font-size: 1.625rem; /* 26 */
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0;
		user-select: none;
		transition: background var(--dur-fast) var(--ease-out);
	}

	/* The gap between keys belongs to the keys: half of it to each side. */
	.key::before {
		content: '';
		position: absolute;
		inset: -2px;
	}

	.key:active {
		background: var(--surface-3);
	}

	@media (hover: hover) {
		.key:hover {
			background: var(--surface-3);
		}
	}
</style>
