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
	 * Phone order — 1-2-3 on top, 7-8-9 at the bottom. Every numeric keyboard
	 * the phone itself shows puts 1-2-3 on top, and the pad kept losing to that
	 * muscle memory (DECISIONS.md, 2026-09-01).
	 */
	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let clearedByHold = false;

	/** Hold backspace to wipe the amount — faster than tapping it away. */
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
		<button type="button" class="key" onclick={() => ondigit(key)}>{key}</button>
	{/each}

	<button type="button" class="key" onclick={oncomma} aria-label="desetinná čárka">,</button>

	<button type="button" class="key" onclick={() => ondigit('0')}>0</button>

	<button
		type="button"
		class="key"
		aria-label="smazat číslici, podržením smažeš vše"
		onclick={deleteDigit}
		onpointerdown={startHold}
		onpointerleave={cancelHold}
		onpointercancel={cancelHold}
	>
		<Icon name="backspace" size={24} stroke={1.8} />
	</button>
</div>

<style>
	.keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
	}

	/**
	 * A key is transparent on the ground and lights up to the card colour
	 * under the thumb. 56 px tall on a phone with the room; never under 44.
	 */
	.key {
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

	.key:active {
		background: var(--surface);
	}

	@media (hover: hover) {
		.key:hover {
			background: var(--surface);
		}
	}
</style>
