<script lang="ts">
	/**
	 * The toast: one glass pill in the ink, centred above the tab bar. When
	 * money moved, the glass takes the direction's colour — red for an
	 * expense, green for an income — so the confirmation is read before it is
	 * read (Q65).
	 *
	 * "−410,00 Kč · JÍDLO · Restaurace" — the amount is the message and the
	 * rest is what it was. A toast that can be taken back carries Zpět on its
	 * right, because a mis-tapped amount that cannot be undone immediately is
	 * exactly the friction that killed the spreadsheet; the same pill reads
	 * Obnovit when a new build is waiting. Tapping the pill puts it away.
	 */
	import { formatMoney } from '$lib/domain/money';
	import { toast } from './toast.svelte';

	async function act() {
		const action = toast.current?.action;
		toast.dismiss();
		await action?.run();
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
			<div
				class="toast"
				class:toast--out={t.tone === 'out'}
				class:toast--in={t.tone === 'in'}
				role="presentation"
				onclick={toast.dismiss}
			>
				<span class="toast__text">{text(t)}</span>
				{#if t.action}
					<button
						type="button"
						class="toast__action"
						onclick={(event) => {
							event.stopPropagation();
							void act();
						}}
					>
						{t.action.label}
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
		background: var(--glass);
		border: 1px solid var(--glass-edge);
		-webkit-backdrop-filter: blur(24px) saturate(1.6);
		backdrop-filter: blur(24px) saturate(1.6);
		color: var(--ink);
		font-size: var(--text-md);
		font-weight: 600;
		text-align: center;
		box-shadow: var(--elev-glass);
		pointer-events: auto;
		animation: toast-in var(--dur-base) var(--ease-out);
	}

	/* Money moved: the same glass, tinted the direction's colour under a white
	   line — red for what left, green for what arrived (Q65). The Zpět pill
	   inside keeps the theme's own pill, which reads on both tints. */
	.toast--out {
		background: var(--glass-out);
		border-color: var(--glass-tint-edge);
		color: var(--glass-tint-ink);
	}

	.toast--in {
		background: var(--glass-in);
		border-color: var(--glass-tint-edge);
		color: var(--glass-tint-ink);
	}

	/* Without backdrop blur the glass has nothing to frost; go opaque. */
	@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
		.toast {
			background: var(--surface);
		}

		.toast--out {
			background: var(--danger);
		}

		.toast--in {
			background: var(--in);
		}
	}

	.toast__text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toast__action {
		flex: none;
		margin: -6px -8px -6px 0;
		padding: 6px 12px;
		border-radius: var(--radius-full);
		background: var(--pill);
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
