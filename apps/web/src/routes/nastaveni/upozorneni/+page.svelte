<script lang="ts">
	/**
	 * Nastavení · Upozornění — what the phone says on its own (2026-10-18).
	 *
	 * Three switches, all off until turned on: the evening question at an hour
	 * of his choosing, an automatic payment that went, a payment waiting for
	 * its tap. The last card says how they will arrive, because that depends
	 * on things outside the app — the system's permission, a paired server
	 * with keys — and a switch that is on but cannot deliver must say so
	 * rather than stay quietly silent. The rules are `domain/notifications.ts`,
	 * the delivery `lib/notify/`.
	 */
	import { liveQuery } from 'dexie';
	import { resolve } from '$app/paths';
	import { getNoticePrefs, setNoticePrefs } from '$lib/db/repo';
	import { db } from '$lib/db/schema';
	import { IS_DEMO } from '$lib/demo';
	import { PAYMENTS, counted } from '$lib/domain/czech';
	import {
		DEFAULT_NOTICE_PREFS,
		anyNoticeOn,
		isClockTime,
		type NoticePrefs
	} from '$lib/domain/notifications';
	import type { Schedule } from '$lib/domain/types';
	import {
		askPermission,
		lastChannelState,
		permission,
		syncChannels,
		type ChannelState
	} from '$lib/notify/push';
	import { PREFS_CHANGED, previewNotice } from '$lib/notify/watch';
	import AppBar from '$lib/ui/AppBar.svelte';
	import TabBar from '$lib/ui/TabBar.svelte';
	import { toast } from '$lib/ui/toast.svelte';

	let prefs = $state<NoticePrefs>({ ...DEFAULT_NOTICE_PREFS });
	let allowed = $state(permission());
	let channel = $state<ChannelState>(lastChannelState());
	let checking = $state(true);

	$effect(() => {
		void getNoticePrefs().then((stored) => (prefs = stored));
		void syncChannels().then((state) => {
			channel = state;
			checking = false;
		});
	});

	const schedules = liveQuery(async () =>
		(await db().schedules.toArray()).filter((s: Schedule) => !s.isDeleted && !s.isArchived)
	);
	const autoCount = $derived(
		(($schedules ?? []) as Schedule[]).filter((s) => s.mode === 'auto').length
	);
	const confirmCount = $derived(
		(($schedules ?? []) as Schedule[]).filter((s) => s.mode === 'confirm').length
	);

	async function save(next: NoticePrefs) {
		prefs = next;
		await setNoticePrefs(next);
		dispatchEvent(new Event(PREFS_CHANGED));
		checking = true;
		channel = await syncChannels();
		checking = false;
	}

	/** Turning the first switch on is the moment to ask — the browser wants a tap behind it. */
	async function flip(key: 'evening' | 'auto' | 'awaiting') {
		const on = !prefs[key];
		if (on && allowed === 'default') allowed = await askPermission();
		await save({ ...prefs, [key]: on });
	}

	async function setClock(key: 'eveningAt' | 'paymentsAt', value: string) {
		if (!isClockTime(value) || value === prefs[key]) return;
		await save({ ...prefs, [key]: value });
	}

	async function tryIt() {
		if (allowed === 'default') allowed = await askPermission();
		const shown = await previewNotice();
		if (!shown) toast.show('Upozornění teď nejde ukázat — systém je nepovolil.');
	}

	const delivery = $derived.by(() => {
		if (!anyNoticeOn(prefs)) return 'Zapni nahoře, co ti má Prosper říkat sám od sebe.';
		switch (channel.gap) {
			case null:
				return channel.channel === 'server'
					? 'Přes server: dorazí v nastavenou chvíli, i když je Prosper zavřený.'
					: 'Jen když je Prosper otevřený.';
			case 'unpaired':
				return 'Zatím jen když je Prosper otevřený. Aby dorazila i na zavřenou aplikaci, spáruj synchronizaci — server pak telefon v nastavenou chvíli probudí.';
			case 'no-keys':
				return 'Server upozornění neposílá, nemá nastavené klíče. Zatím jen když je Prosper otevřený.';
			case 'offline':
				return 'Server teď neodpovídá. Zkusí se to znovu při dalším spuštění; do té doby jen když je Prosper otevřený.';
			case 'no-push':
				return 'Tenhle prohlížeč neumí push. Upozornění přijdou, jen když je Prosper otevřený.';
		}
		return '';
	});
</script>

<svelte:head>
	<title>Prosper — upozornění</title>
</svelte:head>

<main class="page">
	<AppBar title="Upozornění" back="/nastaveni" />

	{#if allowed === 'unsupported'}
		<section class="card card--flag">
			<p class="hint">
				Tenhle prohlížeč upozornění neumí. Na iPhonu fungují, až když je Prosper přidaný na plochu a
				otevřený odtamtud.
			</p>
		</section>
	{:else if allowed === 'denied'}
		<section class="card card--flag">
			<p class="hint">
				Upozornění jsou pro Prosper v systému zakázaná. Povolíš je v nastavení telefonu u aplikace
				Prosper. Do té doby se ozve jen tady v aplikaci.
			</p>
		</section>
	{/if}

	<section class="card">
		<div class="switch">
			<span class="switch__text">
				<span class="switch__title">Večerní kontrola</span>
				<span class="hint">
					V nastavenou hodinu se zeptá, jestli máš dnešek zapsaný, a řekne, co v něm je. Nic
					nepotvrzuješ — ťuknutím otevřeš zápis.
				</span>
			</span>
			<button
				type="button"
				class="toggle"
				role="switch"
				aria-checked={prefs.evening}
				aria-label="Večerní kontrola"
				onclick={() => flip('evening')}
			></button>
		</div>
		{#if prefs.evening}
			<label class="field">
				<span class="field__label">V kolik</span>
				<input
					class="field__input"
					type="time"
					value={prefs.eveningAt}
					onchange={(event) => setClock('eveningAt', event.currentTarget.value)}
				/>
			</label>
		{/if}
	</section>

	<section class="card">
		<h2 class="label">Pravidelné platby</h2>
		<div class="switch">
			<span class="switch__text">
				<span class="switch__title">Proběhla automatická platba</span>
				<span class="hint">
					V den splatnosti — hypotéka a všechno, co se zapisuje samo{autoCount > 0
						? ` (${counted(autoCount, PAYMENTS)})`
						: ''}.
				</span>
			</span>
			<button
				type="button"
				class="toggle"
				role="switch"
				aria-checked={prefs.auto}
				aria-label="Proběhla automatická platba"
				onclick={() => flip('auto')}
			></button>
		</div>
		<div class="switch">
			<span class="switch__text">
				<span class="switch__title">Platba čeká na potvrzení</span>
				<span class="hint">
					Co na Domů čeká na tvoje ťuknutí{confirmCount > 0
						? ` (${counted(confirmCount, PAYMENTS)})`
						: ''}.
				</span>
			</span>
			<button
				type="button"
				class="toggle"
				role="switch"
				aria-checked={prefs.awaiting}
				aria-label="Platba čeká na potvrzení"
				onclick={() => flip('awaiting')}
			></button>
		</div>
		{#if prefs.auto || prefs.awaiting}
			<label class="field">
				<span class="field__label">V den splatnosti v</span>
				<input
					class="field__input"
					type="time"
					value={prefs.paymentsAt}
					onchange={(event) => setClock('paymentsAt', event.currentTarget.value)}
				/>
			</label>
		{/if}
		{#if autoCount + confirmCount === 0}
			<p class="hint">
				Zatím tu žádná pravidelná platba není. Přidáš ji v <a class="link" href={resolve('/platby')}
					>Přehledu › Platby</a
				>.
			</p>
		{/if}
	</section>

	<section class="card">
		<h2 class="label">Jak dorazí</h2>
		<p class="delivery" class:delivery--quiet={checking}>{delivery}</p>
		{#if channel.periodic && channel.channel !== 'server'}
			<p class="hint">Android je občas doručí i bez serveru, jen ne přesně v nastavenou hodinu.</p>
		{/if}
		{#if channel.gap === 'unpaired' && anyNoticeOn(prefs) && !IS_DEMO}
			<a class="link" href={resolve('/nastaveni/sync')}>Spárovat synchronizaci</a>
		{/if}
		{#if allowed !== 'unsupported' && allowed !== 'denied'}
			<button type="button" class="btn btn--sm delivery__try" onclick={tryIt}>Vyzkoušet</button>
		{/if}
	</section>
</main>

<TabBar />

<style>
	/* A switch with its name and what it does: the toggle stays on the
	   thumb's side, the copy wraps beside it. */
	.switch {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-1) 0;
	}

	.switch + .switch {
		padding-top: var(--space-3);
		border-top: 1px solid var(--hairline);
	}

	.switch .toggle {
		margin-top: 2px;
	}

	.switch__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.switch__title {
		font-size: var(--text-base);
		font-weight: 600;
	}

	.card--flag {
		background: var(--flag-wash);
	}

	.card--flag .hint {
		color: var(--ink);
	}

	.delivery {
		font-size: var(--text-md);
		line-height: var(--leading-base);
	}

	.delivery--quiet {
		color: var(--ink-2);
	}

	.delivery__try {
		align-self: flex-start;
	}
</style>
