<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		children: Snippet;
	}

	let { open, title, onclose, children }: Props = $props();

	let dialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} {onclose} oncancel={onclose} aria-label={title}>
	<div class="sheet">
		<div class="sheet__grip" aria-hidden="true"></div>

		<header class="sheet__head">
			<h2>{title}</h2>
			<button type="button" class="sheet__close" onclick={onclose} aria-label="Zavřít">
				<Icon name="close" size={20} />
			</button>
		</header>

		<div class="sheet__body">
			{@render children()}
		</div>
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
	}

	/* The grab handle. It says which edge this thing is hinged on before any of
	   the words do. */
	.sheet__grip {
		flex: none;
		width: 38px;
		height: 4px;
		margin: var(--space-3) auto 0;
		border-radius: var(--radius-full);
		background: var(--hairline-2);
	}

	.sheet__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4) var(--space-4);
	}

	.sheet__head h2 {
		font-size: var(--text-lg);
		font-weight: 600;
		letter-spacing: var(--track-tight);
	}

	.sheet__close {
		display: grid;
		place-items: center;
		flex: none;
		width: var(--touch);
		height: var(--touch);
		margin: calc(var(--space-2) * -1) calc(var(--space-3) * -1) calc(var(--space-2) * -1) 0;
		border-radius: var(--radius-full);
		color: var(--ink-3);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.sheet__close:active {
		background: var(--surface-2);
		color: var(--ink);
	}

	@media (hover: hover) {
		.sheet__close:hover {
			background: var(--surface-2);
			color: var(--ink);
		}
	}

	.sheet__body {
		padding: 0 var(--space-4) var(--space-5);
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* Wider than a phone: a centred panel rather than a hinged sheet. */
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

		.sheet__grip {
			display: none;
		}

		.sheet__head {
			padding-top: var(--space-4);
		}
	}
</style>
