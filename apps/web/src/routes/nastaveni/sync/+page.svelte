<script lang="ts">
	/**
	 * Nastavení · Synchronizace — pairing, or the last cycle to the minute.
	 * The only screen that mentions sync at all: a cycle runs in the
	 * background and never blocks anything (§10.6), so there is nothing to
	 * show anywhere else.
	 */
	import { formatDateTime } from '$lib/domain/datetime';
	import { RECORDS, counted } from '$lib/domain/czech';
	import { defaultBaseUrl, pair, unpair } from '$lib/sync/pair';
	import { SYNC_LABEL, initSync, syncNow, syncStatus } from '$lib/sync/status.svelte';
	import AppBar from '$lib/ui/AppBar.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	const sync = syncStatus();
	let baseUrl = $state(defaultBaseUrl());
	let code = $state('');
	let deviceName = $state('');
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		void initSync();
	});

	async function runPair() {
		busy = true;
		error = '';
		try {
			await pair({
				baseUrl: baseUrl.trim(),
				code: code.trim(),
				deviceName: deviceName.trim() || 'Telefon'
			});
			code = '';
			toast.show('Spárováno');
		} catch (e) {
			error = e instanceof Error ? e.message : 'Spárovat se nepodařilo';
		} finally {
			busy = false;
		}
	}

	async function runUnpair() {
		await unpair();
		toast.show('Odpojeno');
	}
</script>

<svelte:head>
	<title>Prosper — synchronizace</title>
</svelte:head>

<main class="page">
	<AppBar title="Synchronizace" back="/nastaveni" />

	<section class="card">
		{#if sync.state === 'off'}
			<p class="hint">
				Zatím jen tenhle prohlížeč. Spáruj zařízení se serverem a záznamy se budou přenášet mezi
				telefonem a počítačem — zapisovat půjde dál i offline, fronta se odešle, až bude signál.
			</p>

			<label class="field">
				<span class="field__label">Adresa serveru</span>
				<input
					class="field__input"
					bind:value={baseUrl}
					placeholder="https://prosper.example.com"
					autocomplete="off"
					inputmode="url"
				/>
			</label>

			<div class="pair">
				<label class="field">
					<span class="field__label">Párovací kód</span>
					<input class="field__input" bind:value={code} autocomplete="off" inputmode="numeric" />
				</label>
				<label class="field">
					<span class="field__label">Název zařízení</span>
					<input class="field__input" bind:value={deviceName} placeholder="Telefon" />
				</label>
			</div>

			{#if error}
				<p class="error-text">{error}</p>
			{/if}

			<div class="actions">
				<button
					type="button"
					class="btn btn--primary pair__go"
					disabled={busy || !baseUrl.trim() || !code.trim()}
					onclick={runPair}
				>
					{busy ? 'Páruji…' : 'Spárovat'}
				</button>
			</div>
		{:else}
			<dl class="facts">
				<div>
					<dt>Stav</dt>
					<dd data-state={sync.state} class="sync-state">{SYNC_LABEL[sync.state]}</dd>
				</div>
				<div>
					<dt>Čeká na odeslání</dt>
					<dd>{sync.pending}</dd>
				</div>
				<div>
					<dt>Naposledy</dt>
					<dd>{sync.lastSyncedAt ? formatDateTime(sync.lastSyncedAt) : '—'}</dd>
				</div>
			</dl>

			{#if sync.lastError}
				<p class="error-text">{sync.lastError}</p>
			{/if}

			<p class="hint">
				{sync.pending > 0
					? `${counted(sync.pending, RECORDS)} zatím jen tady. Dokud fronta nedojede na nulu, druhá kopie sešitu neexistuje.`
					: 'Fronta je prázdná — všechno je i na serveru.'}
			</p>

			<div class="actions">
				<button type="button" class="btn" onclick={() => void syncNow()}>Synchronizovat teď</button>
				<button type="button" class="btn btn--quiet" onclick={runUnpair}>Odpojit</button>
			</div>
		{/if}
	</section>
</main>

<TabBar />

<style>
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	@media (max-width: 360px) {
		.pair {
			grid-template-columns: 1fr;
		}
	}

	.pair__go {
		min-height: 44px;
		padding: 0 var(--space-5);
	}

	.sync-state[data-state='error'] {
		color: var(--danger);
	}

	.sync-state[data-state='idle'] {
		color: var(--in);
	}
</style>
