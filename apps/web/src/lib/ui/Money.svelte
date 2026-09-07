<script lang="ts">
	import { formatMoney, type FormatOptions, type Minor } from '$lib/domain/money';

	interface Props extends FormatOptions {
		value: Minor;
		/** Colour by direction. Off for neutral contexts like a balance column. */
		colour?: boolean;
		size?: 'xs' | 'sm' | 'md' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
		/** 600 by default — a figure is emphasised. Off for a quiet secondary one. */
		bold?: boolean;
	}

	let {
		value,
		currency = true,
		sign = 'auto',
		code = 'CZK',
		colour = true,
		size = 'base',
		bold = true
	}: Props = $props();

	const tone = $derived(colour && value !== 0 ? (value < 0 ? 'money--out' : 'money--in') : '');
</script>

<span class="money {tone} size-{size}" class:money--light={!bold}
	>{formatMoney(value, { currency, sign, code })}</span
>

<style>
	/* The money scale, tightening as it grows. */
	.size-xs {
		font-size: var(--text-xs);
	}

	.size-sm {
		font-size: var(--text-sm);
	}

	.size-md {
		font-size: var(--text-md);
	}

	.size-base {
		font-size: var(--text-base);
	}

	.size-lg {
		font-size: var(--text-lg);
	}

	.size-xl {
		font-size: var(--text-xl);
		letter-spacing: var(--track-xl);
	}

	.size-2xl {
		font-size: var(--text-2xl);
		letter-spacing: var(--track-title);
		line-height: var(--leading-tight);
	}

	.size-3xl {
		font-size: var(--text-3xl);
		letter-spacing: var(--track-3xl);
		line-height: var(--leading-tight);
	}

	.size-4xl {
		font-size: var(--text-4xl);
		letter-spacing: var(--track-4xl);
		line-height: 1;
	}
</style>
