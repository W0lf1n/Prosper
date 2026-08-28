<script lang="ts">
	/**
	 * The sheet, and the way out of it.
	 *
	 * There is no close button. There was an `✕` in the corner until 2026-08-28
	 * and it was the wrong control twice over: it sat at the far top-right of a
	 * phone held one-handed — the one corner a thumb cannot reach — and it drew
	 * a second exit next to the grip, which is already a picture of how this
	 * thing opens and shuts. The grip now does what it looks like it does.
	 *
	 * Three ways out, and none of them is a target to aim at: pull the top of
	 * the sheet down, tap the blurred app behind it, or press Esc. There is one
	 * more that nobody sees — a `visually-hidden` button at the end, because a
	 * drag gesture is not something every assistive technology can produce, and
	 * Esc is not something a touch screen reader has.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		children: Snippet;
	}

	let { open, title, onclose, children }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	// ── the pull ────────────────────────────────────────────────────────────

	/** How far the sheet has been pulled from rest. Positive is down. */
	let pulled = $state(0);
	let dragging = $state(false);

	let from = 0;
	let since = 0;
	/** The sheet's own height, measured at grab: the threshold is a share of it. */
	let span = 0;

	/**
	 * Far enough to mean it.
	 *
	 * A share of the sheet rather than a fixed distance, because these range
	 * from a four-line confirmation to a full keypad, and 100 px is most of the
	 * first and a twitch on the second. The floor stops a short sheet from
	 * closing on a tap that moved.
	 */
	const FAR_ENOUGH = 0.3;
	const AT_LEAST = 72;
	/** px per ms. A flick beats the distance — that is what makes it feel light. */
	const FLICK = 0.5;

	function grab(event: PointerEvent) {
		// Left button or touch. A right-click on the header is not a gesture.
		if (event.button > 0) return;
		// Keeps the gesture alive once the finger leaves the handle, which it
		// does immediately — the handle is at the top and the pull is downward.
		// Not fatal if the browser refuses: the drag simply ends at the edge.
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
		// Down tracks the finger exactly. Up is rubber-banded rather than
		// refused: a pull that overshoots should feel like resistance, not like
		// the sheet came off its hinge.
		pulled = dy >= 0 ? dy : dy / 6;
	}

	function release(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;

		const elapsed = Math.max(1, event.timeStamp - since);
		const speed = pulled / elapsed;
		const enough = Math.max(AT_LEAST, span * FAR_ENOUGH);

		// Back to rest either way. On the way out the whole dialog is already
		// fading and travelling, so the sheet settling inside it is not seen;
		// what it buys is that a sheet can never be left stuck half-open.
		const dismissing = pulled > enough || (pulled > 12 && speed > FLICK);
		pulled = 0;
		if (dismissing) onclose();
	}

	/**
	 * A click that lands on the dialog itself landed on the backdrop — the sheet
	 * covers the dialog's own box entirely.
	 */
	function tapOutside(event: MouseEvent) {
		if (event.target === dialog) onclose();
	}
</script>

<dialog bind:this={dialog} {onclose} oncancel={onclose} onclick={tapOutside} aria-label={title}>
	<div bind:this={panel} class="sheet" class:sheet--held={dragging} style:translate="0 {pulled}px">
		<!--
		  The grip and the title are one surface, because a 38 × 4 px bar is a
		  picture rather than a target: the whole top of the sheet is what the
		  thumb actually lands on.
		-->
		<div
			class="sheet__handle"
			role="presentation"
			onpointerdown={grab}
			onpointermove={move}
			onpointerup={release}
			onpointercancel={release}
		>
			<div class="sheet__grip" aria-hidden="true"></div>

			<header class="sheet__head">
				<h2>{title}</h2>
			</header>
		</div>

		<div class="sheet__body">
			{@render children()}
		</div>

		<!-- Reachable by keyboard and screen reader, drawn nowhere. -->
		<button type="button" class="visually-hidden" onclick={onclose}>Zavřít</button>
	</div>
</dialog>

<style>
	/**
	 * The sheet arrives from the edge it is hinged on and leaves the same way.
	 *
	 * Written so that the *open* state is the plain rule and the closed state is
	 * the exception. That ordering is deliberate rather than stylistic: a sheet
	 * whose visibility depends on a transition having run is a sheet that is
	 * invisible on any browser without `@starting-style`, and invisible again
	 * anywhere the transition never gets a frame. This way the failure mode is
	 * "it appears without animating", which nobody will ever file a bug about.
	 *
	 * Both directions need `allow-discrete`, or the browser applies the UA's
	 * `display: none` on the first frame of the exit and the sheet vanishes
	 * instead of leaving. `@starting-style` supplies the frame before the
	 * entrance.
	 */
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
		scale: 1;
		transition:
			opacity var(--dur-base) var(--ease-out),
			translate var(--dur-base) var(--ease-settle),
			scale var(--dur-base) var(--ease-out),
			overlay var(--dur-base) allow-discrete,
			display var(--dur-base) allow-discrete;
	}

	/* Where it rests when shut — and the frame the exit travels towards. */
	dialog:not([open]) {
		opacity: 0;
		translate: 0 14px;
		scale: 0.99;
	}

	@starting-style {
		dialog[open] {
			opacity: 0;
			translate: 0 14px;
			scale: 0.99;
		}
	}

	/* The ground goes out of focus rather than merely dark: the sheet is in
	   front of the app, not painted over it. */
	dialog::backdrop {
		background: rgb(4 6 7 / 58%);
		backdrop-filter: blur(10px) saturate(0.9);
		transition:
			background var(--dur-base) var(--ease-out),
			backdrop-filter var(--dur-base) var(--ease-out),
			overlay var(--dur-base) allow-discrete,
			display var(--dur-base) allow-discrete;
	}

	dialog:not([open])::backdrop {
		background: rgb(4 6 7 / 0%);
		backdrop-filter: blur(0px);
	}

	@starting-style {
		dialog[open]::backdrop {
			background: rgb(4 6 7 / 0%);
			backdrop-filter: blur(0px);
		}
	}

	.sheet {
		display: flex;
		flex-direction: column;
		/**
		 * 88 % of the glass, and never past the notch. On a tall phone the first
		 * term wins and the sheet leaves a strip of blurred app above it; on a
		 * short one — landscape, or the keyboard up under a search field — the
		 * second takes over and the sheet stops clear of the status bar instead
		 * of sliding underneath it. `.sheet__body` scrolls either way.
		 */
		max-height: min(88dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--space-5)));
		background: var(--surface);
		border: 1px solid var(--hairline);
		border-bottom: none;
		border-radius: var(--radius-xl) var(--radius-xl) 0 0;
		box-shadow: var(--edge-strong), var(--elev-sheet);
		padding-bottom: env(safe-area-inset-bottom, 0px);
		/* The spring back. Suppressed while a finger is on it, or the sheet
		   lags a frame behind the thumb and the whole thing feels wet. */
		transition: translate var(--dur-base) var(--ease-settle);
	}

	.sheet--held {
		transition: none;
	}

	/**
	 * The part you can pull.
	 *
	 * `touch-action: none` is what stops the browser from reading the same
	 * drag as a scroll or a pull-to-refresh — without it the gesture works on a
	 * mouse and does nothing on the phone it was built for.
	 */
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

	/* The grab handle. It says which edge this thing is hinged on before any of
	   the words do — and now it is also the control that does it. */
	.sheet__grip {
		width: 38px;
		height: 4px;
		margin: var(--space-3) auto 0;
		border-radius: var(--radius-full);
		background: var(--hairline-2);
		transition:
			background var(--dur-fast) var(--ease-out),
			width var(--dur-fast) var(--ease-out);
	}

	.sheet--held .sheet__grip {
		width: 52px;
		background: var(--ink-3);
	}

	@media (hover: hover) {
		.sheet__handle:hover .sheet__grip {
			background: var(--ink-3);
		}
	}

	/* No trailing control any more, so the title is free to use the full width
	   and the row is padded to a thumb's worth on its own. */
	.sheet__head {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		padding: var(--space-2) var(--space-4) var(--space-4);
	}

	.sheet__head h2 {
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: var(--track-tight);
	}

	.sheet__body {
		padding: 0 var(--space-4) var(--space-5);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* Wider than a phone: a centred panel rather than a hinged sheet. The pull
	   still works — it is the same gesture with a mouse — but the grip is not
	   pretending to be a hinge it does not have. */
	@media (min-width: 35rem) {
		dialog {
			margin: auto;
		}

		dialog:not([open]) {
			translate: 0 10px;
		}

		@starting-style {
			dialog[open] {
				translate: 0 10px;
			}
		}

		.sheet {
			max-height: 84dvh;
			border-radius: var(--radius-xl);
			border: 1px solid var(--hairline);
			box-shadow: var(--edge), var(--elev-3);
		}

		/* The grip stays. On a phone it says which edge the sheet is hinged on;
		   here it says the panel can still be thrown away with the pointer,
		   which is the only affordance left now that the ✕ is gone. */
		.sheet__head {
			padding-top: var(--space-3);
		}
	}
</style>
