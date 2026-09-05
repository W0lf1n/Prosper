<script lang="ts">
	/**
	 * The category editor: a name, a type, a colour and an icon.
	 *
	 * Opened from a row in Settings for an existing bucket, or from "Nová
	 * kategorie" for a fresh one. On an existing bucket every change applies
	 * live — the preview at the top is the same circle every screen draws, so
	 * picking a colour is watching the whole app change — and Hotovo only
	 * closes. On a new bucket the fields are held until the pill commits them.
	 */
	import type { Category, SpendType } from '$lib/domain/types';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';
	import {
		CATEGORY_COLORS,
		CATEGORY_ICONS,
		categoryStyle,
		colorVar,
		type CategoryColor
	} from './palette';
	import type { IconName } from './Icon.svelte';

	export interface CategoryInput {
		name: string;
		spendType: SpendType;
		isIncome: boolean;
		icon: string;
		color: string;
	}

	interface Props {
		open: boolean;
		/** The bucket being edited, or null for a new one. */
		category: Category | null;
		oncreate: (input: CategoryInput) => Promise<void>;
		onpatch: (
			id: string,
			patch: Partial<CategoryInput> & { isArchived?: boolean }
		) => Promise<void>;
		onclose: () => void;
	}

	let { open, category, oncreate, onpatch, onclose }: Props = $props();

	const SPEND_TYPES: { value: SpendType; label: string }[] = [
		{ value: 'need', label: 'nutné' },
		{ value: 'want', label: 'chtěné' },
		{ value: 'give', label: 'dávání' },
		{ value: 'save', label: 'spoření' },
		{ value: 'debt', label: 'dluh' }
	];

	let name = $state('');
	let spendType = $state<SpendType>('want');
	let isIncome = $state(false);
	let icon = $state<IconName>('tag');
	let color = $state<CategoryColor>('stone');
	let confirmingArchive = $state(false);

	/**
	 * Patches leave one at a time. Each `updateCategory` reads the row before it
	 * writes, so two taps inside one IndexedDB round trip — a colour and then an
	 * icon — would have the second read the row before the first landed and
	 * write the old colour back over it. A queue makes the second wait.
	 */
	let queue: Promise<void> = Promise.resolve();

	function patch(fields: Partial<CategoryInput> & { isArchived?: boolean }): Promise<void> {
		if (!category) return Promise.resolve();
		const id = category.id;
		queue = queue.then(() => onpatch(id, fields)).catch(() => undefined);
		return queue;
	}

	/* Re-seed whenever the sheet opens onto a different row (or onto none). */
	let loaded = $state<string | null | undefined>(undefined);
	$effect(() => {
		if (!open) {
			loaded = undefined;
			return;
		}
		const id = category?.id ?? null;
		if (id === loaded) return;
		loaded = id;
		name = category?.name ?? '';
		spendType = category?.spendType ?? 'want';
		isIncome = category?.isIncome ?? false;
		const style = categoryStyle(category);
		icon = style.icon;
		color = style.color;
		confirmingArchive = false;
	});

	const trimmed = $derived(name.trim());

	function pickColor(next: CategoryColor) {
		color = next;
		if (category) void patch({ color: next });
	}

	function pickIcon(next: IconName) {
		icon = next;
		if (category) void patch({ icon: next });
	}

	function commitName() {
		if (category && trimmed && trimmed !== category.name) {
			void patch({ name: trimmed });
		}
	}

	function commitType(next: SpendType) {
		spendType = next;
		if (category) void patch({ spendType: next });
	}

	async function done() {
		if (category) {
			commitName();
			onclose();
			return;
		}
		if (!trimmed) return;
		await oncreate({ name: trimmed, spendType, isIncome, icon, color });
	}

	async function toggleArchive() {
		if (!category) return;
		await patch({ isArchived: !category.isArchived });
		confirmingArchive = false;
	}
</script>

<Sheet {open} title={category ? category.name : 'Nová kategorie'} {onclose}>
	{#snippet head()}
		<div class="preview">
			<span class="circle circle--lg" style="--c: {colorVar(color)}">
				<Icon name={icon} size={24} stroke={2} />
			</span>
			<div class="preview__text">
				<span class="preview__name">{trimmed || 'Nová kategorie'}</span>
				<span class="preview__sub">Ikona a barva kategorie</span>
			</div>
		</div>
	{/snippet}

	<div class="form">
		<label class="field">
			<span class="field__label">Název</span>
			<input
				class="field__input"
				bind:value={name}
				onchange={commitName}
				placeholder="Kategorie"
				autocomplete="off"
				enterkeyhint="done"
			/>
		</label>

		<div class="field">
			<span class="field__label">Typ</span>
			<div class="types">
				{#each SPEND_TYPES as type (type.value)}
					<button
						type="button"
						class="btn"
						class:btn--primary={spendType === type.value}
						aria-pressed={spendType === type.value}
						onclick={() => commitType(type.value)}
					>
						{type.label}
					</button>
				{/each}
			</div>
		</div>

		{#if !category}
			<label class="checkbox">
				<input type="checkbox" bind:checked={isIncome} />
				<span>Příjmová kategorie — částky v ní přicházejí</span>
			</label>
		{/if}

		<div class="field">
			<span class="field__label">Barva</span>
			<div class="swatches">
				{#each CATEGORY_COLORS as option (option)}
					<button
						type="button"
						class="swatch"
						class:swatch--on={color === option}
						style="--c: {colorVar(option)}"
						aria-label="Barva {option}"
						aria-pressed={color === option}
						onclick={() => pickColor(option)}
					></button>
				{/each}
			</div>
		</div>

		<div class="field">
			<span class="field__label">Ikona</span>
			<div class="icons">
				{#each CATEGORY_ICONS as option (option)}
					<button
						type="button"
						class="cell"
						class:cell--on={icon === option}
						aria-label="Ikona {option}"
						aria-pressed={icon === option}
						onclick={() => pickIcon(option)}
					>
						<Icon name={option} size={20} stroke={2} />
					</button>
				{/each}
			</div>
		</div>

		<button type="button" class="btn btn--primary btn--block" disabled={!trimmed} onclick={done}>
			{category ? 'Hotovo' : 'Přidat kategorii'}
		</button>

		{#if category}
			{#if confirmingArchive}
				<div class="archive">
					<p class="hint">
						{category.isArchived
							? `Vrátit „${category.name}“ mezi kategorie?`
							: `Archivovat „${category.name}“? Staré záznamy zůstanou čitelné, jen zmizí z klávesnice.`}
					</p>
					<div class="actions actions--fill">
						<button type="button" class="btn" onclick={() => (confirmingArchive = false)}
							>Zpět</button
						>
						<button
							type="button"
							class="btn"
							class:btn--danger={!category.isArchived}
							onclick={toggleArchive}
						>
							{category.isArchived ? 'Vrátit' : 'Archivovat'}
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="btn btn--quiet btn--block"
					onclick={() => (confirmingArchive = true)}
				>
					{category.isArchived ? 'Vrátit kategorii' : 'Archivovat kategorii'}
				</button>
			{/if}
		{/if}
	</div>
</Sheet>

<style>
	.preview {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
	}

	.preview__text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.preview__name {
		font-size: var(--text-lg);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preview__sub {
		font-size: var(--text-sm);
		color: var(--ink-2);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.types {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.types .btn {
		min-height: 36px;
	}

	.checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--touch);
		font-size: var(--text-md);
		color: var(--ink-2);
		cursor: pointer;
	}

	.checkbox input {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--signal);
		cursor: pointer;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.swatch {
		width: 36px;
		height: 36px;
		border-radius: var(--radius-full);
		background: var(--c);
		transition: box-shadow var(--dur-fast) var(--ease-out);
	}

	.swatch--on {
		box-shadow:
			0 0 0 2px var(--surface),
			0 0 0 4px var(--ink);
	}

	.icons {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		gap: 6px;
	}

	.cell {
		display: grid;
		place-items: center;
		height: 40px;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		color: var(--ink);
		transition:
			background var(--dur-fast) var(--ease-out),
			color var(--dur-fast) var(--ease-out);
	}

	.cell--on {
		background: var(--pill);
		color: var(--pill-ink);
	}

	.archive {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--danger-wash);
	}
</style>
