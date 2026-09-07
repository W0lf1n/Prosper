<script lang="ts">
	/**
	 * Nastavení · Vzhled — systém / světlý / tmavý, one segmented pill. The
	 * choice is the one thing the app keeps in `localStorage` (§11.8), so it
	 * is readable before first paint and a dark launch never flashes white.
	 */
	import AppBar from '$lib/ui/AppBar.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { applyTheme, readTheme, type Theme } from '$lib/ui/theme';

	let theme = $state<Theme>(readTheme());

	const OPTIONS: { value: Theme; label: string }[] = [
		{ value: 'system', label: 'systém' },
		{ value: 'light', label: 'světlý' },
		{ value: 'dark', label: 'tmavý' }
	];

	function chooseTheme(next: Theme) {
		theme = next;
		applyTheme(next);
	}
</script>

<svelte:head>
	<title>Prosper — vzhled</title>
</svelte:head>

<main class="page">
	<AppBar title="Vzhled" back="/nastaveni" />

	<section class="card">
		<div class="seg seg--soft" role="group" aria-label="Motiv">
			{#each OPTIONS as option (option.value)}
				<button
					type="button"
					class="seg__item"
					aria-pressed={theme === option.value}
					onclick={() => chooseTheme(option.value)}
				>
					{option.label}
				</button>
			{/each}
		</div>
		<p class="hint">Tmavý na noc, jednou rukou, se zhasnutým světlem.</p>
	</section>
</main>

<TabBar />
