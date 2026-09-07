<script lang="ts">
	/**
	 * Nastavení · Data — the JSON backup out and in, the spreadsheet, the
	 * counts, and Začít znovu: the app's only destructive action, behind a
	 * typed phrase and a backup ticked by default.
	 */
	import { liveQuery } from 'dexie';
	import { db, SCHEMA_VERSION } from '$lib/db/schema';
	import { exportBackup, importBackup, resetLedger, type Backup } from '$lib/db/repo';
	import { summariseMonth } from '$lib/domain/checks';
	import { RECORDS, counted } from '$lib/domain/czech';
	import { today } from '$lib/domain/datetime';
	import { KIND_LABEL } from '$lib/domain/holdings';
	import type { Minor } from '$lib/domain/money';
	import { sharesOf } from '$lib/domain/receivables';
	import { monthlyRows, monthsCovered } from '$lib/domain/trends';
	import type { Txn } from '$lib/domain/types';
	import { buildXlsx, type Sheet } from '$lib/domain/xlsx';
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

	async function downloadWorkbook() {
		const database = db();
		const [rows, cats, goalRows, holdingRows, valuationRows] = await Promise.all([
			data.accountId
				? database.txns.where('accountId').equals(data.accountId).toArray()
				: database.txns.toArray(),
			database.categories.toArray(),
			database.goals.toArray(),
			database.holdings.toArray(),
			database.valuations.toArray()
		]);

		const live = rows.filter((t) => !t.isDeleted);
		const nameOf = (id: string | null) =>
			id === null ? 'bez kategorie' : (cats.find((c) => c.id === id)?.name ?? 'bez kategorie');

		const ledger: Sheet = {
			name: 'Záznamy',
			header: [
				'Datum',
				'Kategorie',
				'Popis',
				'Částka',
				'Typ',
				'Jednorázový',
				'Dluží mi',
				'Kdo',
				'Vyrovnáno'
			],
			rows: [...live]
				.sort((a, b) => a.date.localeCompare(b.date))
				.map((t) => {
					const shares = sharesOf(t);
					const owedTotal = shares.reduce((total, s) => total + s.amount, 0);
					const settled = shares.filter((s) => s.settledByTxnId !== null).length;
					return [
						{ date: t.date },
						nameOf(t.categoryId),
						t.payee,
						{ money: t.amount },
						cats.find((c) => c.id === t.categoryId)?.spendType ?? '',
						t.isOneOff ? 'ano' : '',
						owedTotal > 0 ? { money: owedTotal as Minor } : null,
						shares.map((s) => s.who.trim() || 'někdo').join(', '),
						shares.length === 0
							? ''
							: settled === shares.length
								? 'ano'
								: settled > 0
									? 'zčásti'
									: ''
					];
				})
		};

		const months = monthsCovered(live);
		const summary: Sheet = {
			name: 'Měsíce',
			header: ['Měsíc', 'Příjem', 'Výdaje', 'Čistý', 'Běžný chod', 'Jednorázové'],
			rows: monthlyRows({ months, txns: live, categories: cats, today: today() }).map((m) => [
				m.month,
				{ money: m.income },
				{ money: m.outflow },
				{ money: m.net },
				{ money: m.recurringOutflow },
				{ money: m.oneOffOutflow }
			])
		};

		const perCategory: Sheet = {
			name: 'Kategorie po měsících',
			header: ['Měsíc', 'Kategorie', 'Typ', 'Částka', 'Počet'],
			rows: months.flatMap((m) =>
				summariseMonth({ month: m, txns: live, categories: cats, today: today() })
					.buckets.filter((b) => b.total !== 0)
					.map((b) => [
						m,
						b.category?.name ?? 'bez kategorie',
						b.category?.spendType ?? '',
						{ money: b.total },
						b.count
					])
			)
		};

		const goalsSheet: Sheet = {
			name: 'Cíle',
			header: ['Cíl', 'Proč', 'Cílová částka', 'Termín', 'Počítá se od', 'Kategorie'],
			rows: goalRows
				.filter((g) => !g.isDeleted)
				.map((g) => [
					g.name,
					g.why,
					{ money: g.targetAmount },
					{ date: g.targetDate },
					{ date: g.startDate },
					nameOf(g.categoryId)
				])
		};

		const wealthSheet: Sheet = {
			name: 'Jmění',
			header: ['Investice', 'Druh', 'Datum hodnoty', 'Hodnota'],
			rows: holdingRows
				.filter((h) => !h.isDeleted && !h.isArchived)
				.flatMap((h) =>
					valuationRows
						.filter((v) => !v.isDeleted && v.holdingId === h.id)
						.sort((a, b) => a.date.localeCompare(b.date))
						.map((v) => [h.name, KIND_LABEL[h.kind], { date: v.date }, { money: v.value }])
				)
		};

		const bytes = buildXlsx([ledger, summary, perCategory, goalsSheet, wealthSheet]);
		const blob = new Blob([bytes as BlobPart], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `prosper-${today()}.xlsx`;
		link.click();
		URL.revokeObjectURL(url);
		toast.show(`Vyexportováno ${counted(live.length, RECORDS)}`);
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
