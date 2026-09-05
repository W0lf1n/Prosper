<script lang="ts">
	/**
	 * The toast: one pill, the primary colours, centred above the tab bar.
	 *
	 * "−410,00 Kč · JÍDLO · Restaurace" — the amount is the message and the
	 * rest is what it was. A toast that can be taken back carries Zpět on its
	 * right, because a mis-tapped amount that cannot be undone immediately is
	 * exactly the friction that killed the spreadsheet. Tapping the pill puts
	 * it away.
	 */
	import { formatMoney } from '$lib/domain/money';
	import { toast } from './toast.svelte';

	async function undo() {
		const action = toast.current?.undo;
		toast.dismiss();
		await action?.();
	}

	function text(t: NonNullable<typeof toast.current>): string {
		if (t.amount === undefined) return t.message;
		const amount = formatMoney(t.amount, { sign: 'always', code: t.code });
		return t.message ? `${amount} · ${t.message}` : amount;
	}
</script>

{#if toast.current}
	{@const t = toast.current}
	{#key t.id}
		<div class="wrap" role="status" aria-live="polite">
			<div class="toast" role="presentation" onclick={toast.dismiss}>
				<span class="toast__text">{text(t)}</span>
				{#if t.undo}
					<button
						type="button"
						class="toast__undo"
						onclick={(event) => {
							event.stopPropagation();
							void undo();
						}}
					>
						Zpět
					</button>
				{/if}
			</div>
		</div>
	{/key}
{/if}

<style>
	/* Absolute inside the app column: on a desktop the app is a phone-shaped
	   column in the middle of a wide window, not the window. */
	.wrap {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		bottom: calc(var(--toast-lift, var(--space-5)) + env(safe-area-inset-bottom, 0px));
		z-index: var(--z-toast);
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		width: 100%;
		max-width: 26rem;
		min-height: 48px;
		padding: 14px 20px;
		border-radius: var(--radius-full);
		background: var(--pill);
		color: var(--pill-ink);
		font-size: var(--text-md);
		font-weight: 600;
		text-align: center;
		box-shadow: var(--elev-toast);
		pointer-events: auto;
		animation: toast-in var(--dur-base) var(--ease-out);
	}

	.toast__text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toast__undo {
		flex: none;
		margin: -6px -8px -6px 0;
		padding: 6px 12px;
		border-radius: var(--radius-full);
		background: color-mix(in srgb, var(--pill-ink) 16%, transparent);
		color: var(--pill-ink);
		font-size: var(--text-sm);
		font-weight: 600;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
</style>
