<script lang="ts">
	import { Combobox } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { Repository } from '@code-assist/intake/repositories';

	let {
		repositories,
		value = $bindable<string[]>([])
	}: {
		repositories: Repository[];
		value?: string[];
	} = $props();
	let query = $state('');
	let open = $state(false);
	const filtered = $derived(
		repositories.filter((repo) => repo.name.toLowerCase().includes(query.toLowerCase()))
	);
	const name = (path: string) =>
		repositories.find((repo) => repo.path === path)?.name ?? path.split('/').at(-1);
</script>

<div class="space-y-3">
	<label for="repository-search" class="text-sm font-medium">Repositories</label>
	<div class="flex flex-wrap gap-2" aria-label="Selected repositories">
		{#each value as path (path)}
			<Button
				type="button"
				variant="secondary"
				size="sm"
				aria-label={`Remove ${name(path)}`}
				onclick={() => (value = value.filter((selected) => selected !== path))}
			>
				{name(path)}<X class="size-3" aria-hidden="true" />
			</Button>
		{/each}
	</div>
	<Combobox.Root
		type="multiple"
		name="repositories"
		bind:value
		bind:open
		inputValue={query}
		onValueChange={() => (query = '')}
		onOpenChangeComplete={(open) => {
			if (!open) query = '';
		}}
	>
		<div class="relative">
			<Combobox.Input
				id="repository-search"
				placeholder="Type to find repositories…"
				oninput={(event) => {
					query = event.currentTarget.value;
					open = true;
				}}
			>
				{#snippet child({ props })}
					<Input {...props} class="pr-10" />
				{/snippet}
			</Combobox.Input>
			<Combobox.Trigger
				class="absolute inset-y-0 right-0 flex w-10 items-center justify-center"
				aria-label="Show repositories"><ChevronDown class="size-4" /></Combobox.Trigger
			>
		</div>
		<Combobox.Portal>
			<Combobox.Content
				sideOffset={5}
				class="z-50 w-(--bits-combobox-anchor-width) rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
			>
				<Combobox.Viewport class="max-h-64 overflow-y-auto">
					{#each filtered as repo (repo.path)}
						<Combobox.Item
							value={repo.path}
							label={repo.name}
							class="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
						>
							{#snippet children({ selected })}
								<Check
									class={`size-4 shrink-0 ${selected ? '' : 'invisible'}`}
									aria-hidden="true"
								/>
								<span class="break-all">{repo.name}</span>
							{/snippet}
						</Combobox.Item>
					{:else}
						<div class="px-3 py-4 text-sm text-muted-foreground">No repositories found.</div>
					{/each}
				</Combobox.Viewport>
			</Combobox.Content>
		</Combobox.Portal>
	</Combobox.Root>
</div>
