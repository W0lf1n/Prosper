<script lang="ts">
	/**
	 * Nastavení · Data — the JSON backup out and in, the spreadsheet, the
	 * counts, and Začít znovu: the app's only destructive action, behind a
	 * typed phrase and a backup ticked by default.
	 */
	import { liveQuery } from 'dexie';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import { resetDemo } from '$lib/db/demo';
	import { exportBackup, importBackup, resetLedger, type Backup } from '$lib/db/repo';
	import { IS_DEMO } from '$lib/demo';
	import { RECORDS, counted } from '$lib/domain/czech';
	import { today } from '$lib/domain/datetime';
	import type { Txn } from '$lib/domain/types';
	import { buildWorkbook } from '$lib/domain/workbook';
	import { buildXlsx } from '$lib/domain/xlsx';
	import { SYNC_LABEL, syncNow, syncStatus } from '$lib/sync/status.svelte';
	import AppBar from '$lib/ui/AppBar.svelte';
	import ResetSheet from '$lib/ui/ResetSheet.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/* Live rows, not every row ever written — tombstones only ever go up. */
	const allTxns = liveQuery(async () =>
		(await db().txns.toArray()).filter((t: Txn) => !t.isDeleted)
	);
	const txnCount = $derived(($allTxns ?? []).length);

	const sync = syncStatus();

	// ── backup ──────────────────────────────────────────────────────────────
	let importInput = $state<HTMLInputElement | null>(null);

	async function downloadBackup() {
		const backup = await exportBackup();
		const blob = new Blob([JSON.stringify(backup, null, '\t')], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `prosper-zaloha-${today()}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * The spreadsheet, laid out as `Výdaje 2026.xlsx` was — a sheet per month,
	 * a column pair per bucket, SUMA at the end — with the rest of the app in
	 * tables after it (Q81). Every account, each in its own months: the file
	 * is the whole ledger, not the account the keypad happens to be on.
	 */
	async function downloadWorkbook() {
		const database = db();
		const [
			accounts,
			txns,
			categories,
			schedules,
			goals,
			monthTargets,
			holdings,
			valuations,
			plans
		] = await Promise.all([
			database.accounts.toArray(),
			database.txns.toArray(),
			database.categories.toArray(),
			database.schedules.toArray(),
			database.goals.toArray(),
			database.monthTargets.toArray(),
			database.holdings.toArray(),
			database.valuations.toArray(),
			database.plans.toArray()
		]);

		const workbook = buildWorkbook({
			accounts,
			txns,
			categories,
			schedules,
			goals,
			monthTargets,
			holdings,
			valuations,
			plans,
			activeAccountId: data.accountId,
			today: today()
		});

		const bytes = buildXlsx(workbook.sheets, { activeSheet: workbook.activeSheet });
		const blob = new Blob([bytes as BlobPart], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `prosper-${today()}.xlsx`;
		link.click();
		URL.revokeObjectURL(url);
		toast.show(`Vyexportováno ${counted(workbook.rowCount, RECORDS)}`);
	}

	async function runImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const parsed = JSON.parse(await file.text()) as Backup;
			const result = await importBackup(parsed);
			toast.show(
				result.skipped > 0
					? `Načteno ${counted(result.txns, RECORDS)}. Poškozené řádky vynechány: ${result.skipped}.`
					: `Načteno ${counted(result.txns, RECORDS)}`
			);
		} catch (error) {
			toast.show(error instanceof Error ? error.message : 'Zálohu se nepodařilo načíst');
		} finally {
			input.value = '';
		}
	}

	// ── starting over ───────────────────────────────────────────────────────
	let resetOpen = $state(false);

	async function pushBeforeReset(): Promise<{ ok: boolean; error: string | null }> {
		await syncNow();
		if (sync.state === 'error') return { ok: false, error: sync.lastError };
		if (sync.pending > 0) {
			return { ok: false, error: `${counted(sync.pending, RECORDS)} zatím čeká ve frontě` };
		}
		return { ok: true, error: null };
	}

	async function runReset() {
		const result = await resetLedger();
		resetOpen = false;
		toast.show(result.txns > 0 ? `Smazáno ${counted(result.txns, RECORDS)}` : 'Sešit je prázdný');
	}

	// ── storage ─────────────────────────────────────────────────────────────
	let persisted = $state<boolean | null>(null);

	$effect(() => {
		void navigator.storage?.persisted?.().then((value) => (persisted = value));
	});

	async function requestPersistence() {
		persisted = (await navigator.storage?.persist?.()) ?? false;
	}
</script>

<svelte:head>
	<title>Prosper — data</title>
</svelte:head>

<main class="page">
	<AppBar title="Data" back="/nastaveni" />

	<section class="card">
		<div class="actions">
			<button type="button" class="btn" onclick={downloadBackup}>Export zálohy</button>
			<button type="button" class="btn" onclick={() => importInput?.click()}>Načíst zálohu</button>
			<button type="button" class="btn" onclick={downloadWorkbook}>Export do Excelu</button>
			<input
				bind:this={importInput}
				type="file"
				accept="application/json"
				class="visually-hidden"
				onchange={runImport}
			/>
		</div>

		<dl class="facts">
			<div>
				<dt>Záznamů</dt>
				<dd>{txnCount}</dd>
			</div>
			<div>
				<dt>Trvalé úložiště</dt>
				<dd>
					{#if persisted === null}
						—
					{:else if persisted}
						<span class="fact-ok">zapnuto</span>
					{:else}
						<button type="button" class="link" onclick={requestPersistence}>vyžádat</button>
					{/if}
				</dd>
			</div>
			<div>
				<dt>Verze schématu</dt>
				<dd>{SCHEMA_VERSION}</dd>
			</div>
			<div>
				<dt>Synchronizace</dt>
				<dd>{SYNC_LABEL[sync.state]}</dd>
			</div>
		</dl>

		<p class="hint">
			<strong>Záloha</strong> je JSON pro obnovu aplikace, <strong>Excel</strong> je na čtení jinde —
			zpátky se načíst nedá. Dokud není synchronizace, žije celý sešit jen v tomhle prohlížeči.
		</p>

		{#if IS_DEMO}
			<!-- The demo's wipe: no phrase, no backup — there is nothing to lose (Q74). -->
			<button type="button" class="btn btn--danger btn--lg btn--block" onclick={resetDemo}>
				Začít znovu
			</button>
			<p class="hint">
				Ukázka: smaže všechno, co tu kdo nazkoušel, a nahraje ukázková data znovu. Trvá to vteřinu.
			</p>
		{:else}
			<button
				type="button"
				class="btn btn--danger btn--lg btn--block"
				onclick={() => (resetOpen = true)}
			>
				Začít znovu
			</button>
			<p class="hint">
				Smaže celý sešit a nechá ti kategorie a nastavení. Zálohu si to nabídne uložit předtím.
			</p>
		{/if}
	</section>
</main>

<ResetSheet
	open={resetOpen}
	paired={sync.state !== 'off'}
	onbackup={downloadBackup}
	onpush={pushBeforeReset}
	onreset={runReset}
	onclose={() => (resetOpen = false)}
/>

<TabBar />

<style>
	.fact-ok {
		color: var(--in);
	}
</style>
