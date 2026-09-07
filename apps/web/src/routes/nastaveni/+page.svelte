<script lang="ts">
	/**
	 * Nastavení — the hub, and the last tab (Q61). Five rows, each a room of
	 * its own with a back chevron here: Účty, Kategorie, Vzhled, Synchronizace,
	 * Data. Every row carries a live one-line summary of what is in the room,
	 * so the hub reads as a status page before it is a menu. A tab screen, so
	 * the title sits in the flow and there is no back — the tabs are peers.
	 */
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { balancesByCurrency } from '$lib/domain/ledger';
	import type { Account, Category, Txn } from '$lib/domain/types';
	import { syncStatus } from '$lib/sync/status.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { settingsRows } from '$lib/ui/settings';
	import { readTheme } from '$lib/ui/theme';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const allAccounts = liveQuery(() => db().accounts.toArray());
	const allCategories = liveQuery(() => db().categories.toArray());
	/* Live rows, not every row ever written — tombstones only ever go up. */
	const allTxns = liveQuery(async () =>
		(await db().txns.toArray()).filter((t: Txn) => !t.isDeleted)
	);

	/* Derived from the live list, not its own `liveQuery` — the account
	   switch happens one page under this one (`CLAUDE.md`). */
	const account = $derived(
		(($allAccounts ?? []) as Account[]).find((a) => a.id === data.accountId) ?? null
	);
	const balance = $derived.by(() => {
		if (!account) return null;
		const groups = balancesByCurrency(($allAccounts ?? []) as Account[], ($allTxns ?? []) as Txn[]);
		return groups.find((g) => g.code === account.currency)?.total ?? null;
	});

	const sync = syncStatus();

	const rows = $derived(
		settingsRows({
			account,
			balance,
			categoryCount: (($allCategories ?? []) as Category[]).filter(
				(c) => !c.isDeleted && !c.isArchived
			).length,
			theme: readTheme(),
			syncState: sync.state,
			txnCount: ($allTxns ?? []).length
		})
	);
</script>

<svelte:head>
	<title>Prosper — nastavení</title>
</svelte:head>

<main class="page">
	<h1 class="title">Nastavení</h1>

	<section class="card card--list">
		{#each rows as row (row.id)}
			<a class="row row--press" href={resolve(row.href)}>
				<span class="circle hub__icon"><Icon name={row.icon} size={20} stroke={1.7} /></span>
				<span class="row__body">
					<span class="row__title">{row.title}</span>
					<span class="row__sub">{row.sub}</span>
				</span>
				<span class="card__go"><Icon name="chevron-right" size={18} /></span>
			</a>
		{/each}
	</section>
</main>

<TabBar />

<style>
	/* Inside a card there is nothing for glass to frost, so the room's circle
	   is the soft surface with the icon in the ink. */
	.hub__icon {
		background: var(--surface-3);
		color: var(--ink);
	}
</style>
