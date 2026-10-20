<script lang="ts">
	import { untrack } from 'svelte';
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
<select
	{id}
	name={selected === '__custom__' ? undefined : name}
	bind:value={selected}
	class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
	aria-describedby={descriptionId}
	required
>
	{#each options as model (model)}<option value={model}>{model}</option>{/each}
	<option value="__custom__">Custom Model…</option>
</select>
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
