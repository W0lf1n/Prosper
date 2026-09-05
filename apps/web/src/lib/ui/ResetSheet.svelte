<script lang="ts">
	/**
	 * Začít znovu — the app's only destructive action, and the only place in it
	 * where friction is the feature.
	 *
	 * Three things stand between a stray tap and an empty ledger, and each one
	 * does a different job. The phrase is the gate: a sentence cannot be typed
	 * by accident, and §13.7's "no check may block a save" does not apply here —
	 * this is not a save. The list names what actually goes, because "všechna
	 * data" is not a sentence anybody can check. The backup box is the way out,
	 * and it is ticked by default: the one person who ever presses this button
	 * is the one person who cannot ask anybody for a copy.
	 *
	 * The backup runs *before* the wipe and the wipe does not start unless it
	 * finished. That ordering is the whole safety property, so the component
	 * owns it rather than the caller.
	 */
	import { RESET_PHRASE, matchesResetPhrase } from '$lib/domain/reset';
	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		/** True once this device is paired, which is what "na server" can mean. */
		paired: boolean;
		/** Write the JSON file out. Rejects if it could not be produced. */
		onbackup: () => Promise<void>;
		/** Flush the outbox and report whether everything actually landed. */
		onpush: () => Promise<{ ok: boolean; error: string | null }>;
		/** Wipe. Only ever reached once the backup above has come back clean. */
		onreset: () => Promise<void>;
		onclose: () => void;
	}

	let { open, paired, onbackup, onpush, onreset, onclose }: Props = $props();

	let typed = $state('');
	let keepBackup = $state(true);
	let busy = $state<null | 'backup' | 'reset'>(null);
	let error = $state('');

	/* A fresh sheet every time it opens: a half-typed phrase left over from a
	   dialog somebody backed out of is a phrase that is already half-passed. */
	$effect(() => {
		if (open) return;
		typed = '';
		keepBackup = true;
		busy = null;
		error = '';
	});

	const unlocked = $derived(matchesResetPhrase(typed));

	async function commit() {
		if (!unlocked || busy) return;
		error = '';

		if (keepBackup) {
			busy = 'backup';
			try {
				await onbackup();
			} catch {
				busy = null;
				error = 'Zálohu se nepodařilo vytvořit. Nic se nesmazalo.';
				return;
			}

			if (paired) {
				const pushed = await onpush();
				if (!pushed.ok) {
					busy = null;
					error =
						`Na server se to teď nedostalo${pushed.error ? ` — ${pushed.error}` : ''}. ` +
						'Soubor se zálohou máš v zařízení. Zkus to znovu, nebo odškrtni ukládání na server.';
					return;
				}
			}
		}

		busy = 'reset';
		try {
			await onreset();
		} finally {
			busy = null;
		}
	}
</script>

<Sheet {open} title="Začít znovu" {onclose}>
	<div class="reset">
		<p class="lead prose">
			Vymaže to celý sešit a necháš si jen to, co sis nastavil. Zpátky to nejde — jinak než ze
			zálohy.
		</p>

		<!--
		  What goes and what stays, side by side. A wipe described only by what it
		  destroys reads as bigger than it is, and somebody then keeps a ledger
		  they wanted rid of because they were afraid of losing their buckets.
		-->
		<dl class="ledger">
			<div class="ledger__row">
				<dt class="ledger__key ledger__key--out">Zmizí</dt>
				<dd class="ledger__val">
					všechny záznamy, cíle a měsíční závazky, investice i jejich hodnoty, pravidelné platby,
					srovnání s bankou a počáteční zůstatek
				</dd>
			</div>
			<div class="ledger__row">
				<dt class="ledger__key ledger__key--in">Zůstane</dt>
				<dd class="ledger__val">kategorie, účet a nastavení téhle aplikace</dd>
			</div>
		</dl>

		<label class="keep">
			<input type="checkbox" bind:checked={keepBackup} disabled={busy !== null} />
			<span class="keep__text">
				<span class="keep__label">Nejdřív ulož všechna moje data do zálohy</span>
				<span class="keep__hint">
					{paired
						? 'Odešle všechno na server a stáhne zálohu i sem do zařízení.'
						: 'Stáhne zálohu jako soubor sem do zařízení. Server zatím žádný nemáš.'}
				</span>
			</span>
		</label>

		<label class="field">
			<span class="field__label">Napiš „{RESET_PHRASE}“</span>
			<input
				class="field__input"
				bind:value={typed}
				placeholder={RESET_PHRASE}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				enterkeyhint="done"
				disabled={busy !== null}
			/>
		</label>

		{#if error}
			<p class="error-text">{error}</p>
		{/if}

		<!-- The sentence the button is standing on, right above the button. -->
		<p class="acknowledge" class:acknowledge--armed={unlocked}>
			<span class="acknowledge__dot" aria-hidden="true"></span>
			Rozumím, že o všechna data z aplikace přijdu.
		</p>

		<button
			type="button"
			class="btn btn--danger btn--block"
			disabled={!unlocked || busy !== null}
			onclick={commit}
		>
			{#if busy === 'backup'}
				Ukládám zálohu…
			{:else if busy === 'reset'}
				Mažu…
			{:else}
				Smazat všechno
			{/if}
		</button>

		<button
			type="button"
			class="btn btn--quiet btn--block"
			disabled={busy !== null}
			onclick={onclose}
		>
			Nechat, jak to je
		</button>
	</div>
</Sheet>

<style>
	.reset {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.lead {
		font-size: var(--text-md);
		color: var(--ink);
	}

	/* Recessed inside the sheet is `--ground-2`, same as everywhere else. */
	.ledger {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--ground-2);
	}

	.ledger__row {
		display: grid;
		grid-template-columns: 5.5rem 1fr;
		gap: var(--space-3);
		align-items: baseline;
	}

	.ledger__key {
		font-size: var(--text-2xs);
		font-weight: 600;
		letter-spacing: var(--track-label);
	}

	.ledger__key--out {
		color: var(--danger);
	}

	.ledger__key--in {
		color: var(--in);
	}

	.ledger__val {
		margin: 0;
		font-size: var(--text-sm);
		line-height: var(--leading-base);
		color: var(--ink-2);
	}

	/* The box is 20 px to look at; the whole label is the 44 px target. */
	.keep {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		min-height: var(--touch);
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		cursor: pointer;
	}

	.keep input {
		flex: none;
		width: 20px;
		height: 20px;
		margin: 2px 0 0;
		accent-color: var(--signal);
		cursor: pointer;
	}

	.keep__text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.keep__label {
		font-size: var(--text-md);
		color: var(--ink);
	}

	.keep__hint {
		font-size: var(--text-xs);
		line-height: var(--leading-base);
		color: var(--ink-3);
	}

	/**
	 * It says the same thing whether or not the phrase has been typed — it is a
	 * statement of fact, not a second gate. The dot fills once the button is
	 * live, so the sentence is at its loudest exactly when it is about to be
	 * true.
	 */
	.acknowledge {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		line-height: var(--leading-snug);
		color: var(--ink-3);
		transition: color var(--dur-base) var(--ease-out);
	}

	.acknowledge--armed {
		color: var(--danger);
	}

	.acknowledge__dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--radius-full);
		border: 1px solid var(--ink-3);
		transition:
			background var(--dur-base) var(--ease-out),
			border-color var(--dur-base) var(--ease-out);
	}

	.acknowledge--armed .acknowledge__dot {
		background: var(--danger);
		border-color: var(--danger);
	}
</style>
