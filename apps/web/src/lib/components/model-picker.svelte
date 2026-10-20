<script lang="ts">
	import { untrack } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Input } from '#lib/components/ui/input/index.js';
	let {
		id,
		name,
		label,
		value,
		options,
		descriptionId
	}: {
		id: string;
		name: string;
		label: string;
		value: string;
		options: string[];
		descriptionId: string;
	} = $props();
	let selected = $state(untrack(() => (options.includes(value) ? value : '__custom__')));
	let custom = $state(untrack(() => (options.includes(value) ? '' : value)));
</script>

<label for={id} class="text-sm font-medium">{label}</label>
<div class="relative">
	<select
		{id}
		name={selected === '__custom__' ? undefined : name}
		bind:value={selected}
		class="h-10 w-full appearance-none rounded-md border border-input bg-background pr-10 pl-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
		aria-describedby={descriptionId}
		required
	>
		{#each options as model (model)}<option value={model}>{model}</option>{/each}
		<option value="__custom__">Custom Model…</option>
	</select>
	<ChevronDown
		class="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
		aria-hidden="true"
	/>
</div>
{#if selected === '__custom__'}
	<label for={`${id}-custom`} class="text-sm font-medium">Custom {label} ID</label>
	<Input
		id={`${id}-custom`}
		{name}
		bind:value={custom}
		placeholder="Enter a model ID"
		required
		autocomplete="off"
		spellcheck={false}
		aria-describedby={descriptionId}
	/>
{/if}
