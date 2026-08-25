<script lang="ts">
	import { formatMoney, type FormatOptions, type Minor } from '$lib/domain/money';

	interface Props extends FormatOptions {
		value: Minor;
		/** Colour by direction. Off for neutral contexts like a balance column. */
		colour?: boolean;
		size?: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
		bold?: boolean;
	}

	let {
		value,
		currency = true,
		sign = 'auto',
		colour = true,
		size = 'base',
		bold = false
	}: Props = $props();

	const tone = $derived(colour && value !== 0 ? (value < 0 ? 'money--out' : 'money--in') : '');
</script>

<span class="money {tone} size-{size}" class:bold>{formatMoney(value, { currency, sign })}</span>

<style>
	/**
	 * The money scale. Mono, tabular, and tightening as it grows — a large
	 * monospace number set at default tracking looks like a licence plate.
	 */
	.size-sm {
		font-size: var(--text-xs);
	}

	.size-base {
		font-size: var(--text-md);
	}

	.size-lg {
		font-size: var(--text-lg);
		letter-spacing: -0.025em;
	}

	.size-xl {
		font-size: var(--text-xl);
		letter-spacing: -0.03em;
	}

	.size-2xl {
		font-size: var(--text-2xl);
		line-height: var(--leading-tight);
		letter-spacing: -0.035em;
	}

	.bold {
		font-weight: 600;
	}
</style>
