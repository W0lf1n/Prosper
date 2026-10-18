<script lang="ts">
	/**
	 * Nastavení · Domů — which cards the launch screen shows, and in what
	 * order (Q95). It lived on Domů itself as a prototype (Q92); asked for in
	 * Settings only, so Domů carries nothing but what it shows. The
	 * arrangement is a synced row: every paired device shows the same Domů.
	 */
	import { liveQuery } from 'dexie';
	import { getHomeLayout, setHomeLayout } from '$lib/db/repo';
	import { DEFAULT_HOME, type HomeLayout } from '$lib/domain/dashboard';
	import AppBar from '$lib/ui/AppBar.svelte';
	import HomeArranger from '$lib/ui/HomeArranger.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';

	const stored = liveQuery(() => getHomeLayout());
	const layout = $derived<HomeLayout>($stored ?? { widgets: [...DEFAULT_HOME] });
</script>

<svelte:head>
	<title>Prosper — Domů</title>
</svelte:head>

<main class="page">
	<AppBar title="Domů" back="/nastaveni" />

	<p class="hint intro">
		Zůstatek měsíce zůstává na Domů nahoře a platby, které čekají na ťuknutí, hned pod ním. Karty
		pod nimi si seřaď, skryj nebo přidej — na všech spárovaných zařízeních stejně.
	</p>

	<HomeArranger {layout} onchange={(next) => void setHomeLayout(next)} />
</main>

<TabBar />

<style>
	.intro {
		padding: 0 var(--space-1);
	}
</style>
