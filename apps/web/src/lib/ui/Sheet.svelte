<script lang="ts">
	/**
	 * The sheet, and the way out of it.
	 *
	 * There is no close button. Three ways out, and none of them is a target
	 * to aim at: pull the top of the sheet down, tap the dimmed app behind it,
	 * or press Esc. One more that nobody sees — a `visually-hidden` button at
	 * the end, because a drag gesture is not something every assistive
	 * technology can produce, and Esc is not something a touch screen reader
	 * has. A sheet that commits something carries its own primary pill, and
	 * that pill closes it on the way out — a commit is not a close control.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		/** Replaces the plain title row — the category editor's preview. */
		head?: Snippet;
		children: Snippet;
	}

	let { open, title, onclose, head, children }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	// ── the pull ────────────────────────────────────────────────────────────

	let pulled = $state(0);
	let dragging = $state(false);

	let from = 0;
	let since = 0;
	let span = 0;

	const FAR_ENOUGH = 0.3;
	const AT_LEAST = 72;
	const FLICK = 0.5;

	function grab(event: PointerEvent) {
		if (event.button > 0) return;
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			/* no capture, still draggable */
		}
		dragging = true;
		from = event.clientY;
		since = event.timeStamp;
		span = panel?.offsetHeight ?? 0;
	}

	function move(event: PointerEvent) {
		if (!dragging) return;
		const dy = event.clientY - from;
		pulled = dy >= 0 ? dy : dy / 6;
	}

	function release(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		const elapsed = Math.max(1, event.timeStamp - since);
		const speed = pulled / elapsed;
		const enough = Math.max(AT_LEAST, span * FAR_ENOUGH);
		const dismissing = pulled > enough || (pulled > 12 && speed > FLICK);
		pulled = 0;
		if (dismissing) onclose();
	}

	function tapOutside(event: MouseEvent) {
		if (event.target === dialog) onclose();
	}
</script>

<dialog bind:this={dialog} {onclose} oncancel={onclose} onclick={tapOutside} aria-label={title}>
	<div bind:this={panel} class="sheet" class:sheet--held={dragging} style:translate="0 {pulled}px">
		<div
			class="sheet__handle"
			role="presentation"
			onpointerdown={grab}
			onpointermove={move}
			onpointerup={release}
			onpointercancel={release}
		>
			<div class="sheet__grip" aria-hidden="true"></div>

			{#if head}
				<div class="sheet__head">{@render head()}</div>
			{:else}
				<header class="sheet__head">
					<h2 class="sheet__title">{title}</h2>
				</header>
			{/if}
		</div>

		<div class="sheet__body">
			{@render children()}
		</div>

		<button type="button" class="visually-hidden" onclick={onclose}>Zavřít</button>
	</div>
</dialog>

<style>
	dialog {
		width: 100%;
		max-width: 34rem;
		max-height: 100dvh;
		margin: auto auto 0;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--ink);
		opacity: 1;
		translate: 0 0;
		transition:
			opacity var(--dur-base) var(--ease-out),
			translate var(--dur-base) var(--ease-settle),
			overlay var(--dur-base) allow-discrete,
			display var(--dur-base) allow-discrete;
	}

	dialog:not([open]) {
		opacity: 0;
		translate: 0 24px;
	}

	@starting-style {
		dialog[open] {
			opacity: 0;
			translate: 0 24px;
		}
	}

	dialog::backdrop {
		background: var(--overlay);
		transition:
			background var(--dur-base) var(--ease-out),
			overlay var(--dur-base) allow-discrete,
			display var(--dur-base) allow-discrete;
	}

	dialog:not([open])::backdrop {
		background: transparent;
	}

	@starting-style {
		dialog[open]::backdrop {
			background: transparent;
		}
	}

	/* 28 px top corners, the card's surface, the one real shadow in the app
	   besides the toast — this layer genuinely floats. */
	.sheet {
		display: flex;
		flex-direction: column;
		max-height: min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--space-5)));
		background: var(--surface);
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		box-shadow: var(--elev-sheet);
		padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
		transition: translate var(--dur-base) var(--ease-settle);
	}

	.sheet--held {
		transition: none;
	}

	.sheet__handle {
		flex: none;
		touch-action: none;
		cursor: grab;
		-webkit-user-select: none;
		user-select: none;
	}

	.sheet--held .sheet__handle {
		cursor: grabbing;
	}

	.sheet__grip {
		width: 36px;
		height: 4px;
		margin: 10px auto 0;
		border-radius: var(--radius-full);
		background: var(--hairline);
		transition: background var(--dur-fast) var(--ease-out);
	}

	.sheet--held .sheet__grip {
		background: var(--ink-3);
	}

	.sheet__head {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		padding: var(--space-3) var(--space-4) var(--space-3);
	}

	.sheet__title {
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.sheet__body {
		padding: 0 var(--space-4);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	@media (min-width: 35rem) {
		dialog {
			margin: auto;
		}

		.sheet {
			max-height: 84dvh;
			border-radius: var(--radius-xl);
			padding-bottom: var(--space-5);
		}
	}
</style>
