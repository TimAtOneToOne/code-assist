<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import { secretForm } from '#lib/secret-feedback.js';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import SecretEditor from '#lib/components/secret-editor.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let search = $state('');
	const query = $derived(search.trim().toLowerCase());
	const matchingSecrets = $derived(
		data.secrets.filter((secret) => {
			const mappings = data.mappings.filter((mapping) => mapping.secretId === secret.id);
			return [
				secret.name,
				secret.description,
				...(secret.aliases ?? []).map((alias) => alias.name),
				...mappings.flatMap((mapping) => [
					mapping.variable,
					mapping.repository.split('/').at(-1) ?? ''
				])
			].some((text) => text.toLowerCase().includes(query));
		})
	);
	const matchingMappings = $derived(
		data.mappings.filter((mapping) => {
			const secret = data.secrets.find((secret) => secret.id === mapping.secretId);
			return [
				mapping.variable,
				mapping.repository.split('/').at(-1) ?? '',
				secret?.name ?? '',
				secret?.description ?? '',
				...(secret?.aliases ?? []).map((alias) => alias.name)
			].some((text) => text.toLowerCase().includes(query));
		})
	);
	$effect(() => {
		if (data.repositoryError) toast.error(data.repositoryError);
	});
	const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
</script>

<svelte:head><title>Secrets & Environment · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
	<div>
		<div class="eyebrow">WORKSPACE SETTINGS</div>
		<h1>Secrets & Environment</h1>
	</div>
	<form method="POST" action="?/consolidate" use:enhance={secretForm} class="ml-auto">
		<Button type="submit" variant="outline">Consolidate Duplicate Secrets</Button>
	</form>
</div>
<div class="mb-6 space-y-2">
	<label for="secret-search" class="sr-only">Search Secrets</label>
	<Input
		id="secret-search"
		type="search"
		bind:value={search}
		placeholder="Search secrets, variables, or repositories…"
		autocomplete="off"
	/>
	<p class="text-sm text-muted-foreground" role="status">
		{matchingSecrets.length} of {data.secrets.length} secrets
	</p>
</div>

<h2 class="mb-4 text-xl font-semibold">Saved Secrets</h2>
{#if query && !matchingSecrets.length}
	<p class="mb-4 text-muted-foreground">No secrets match your search.</p>
{/if}
<div class="grid gap-5 xl:grid-cols-2">
	{#each matchingSecrets as secret (secret.id + secret.updatedAt)}
		<SecretEditor {secret} />
	{/each}
	<SecretEditor />
</div>

<h2 class="mt-8 mb-4 text-xl font-semibold">Repository Environment Mappings</h2>
<p class="mb-5 text-muted-foreground">
	Choose which saved key supplies each variable. Saving an existing repository and variable updates
	its mapping. Rotating a secret updates all mappings that use it.
</p>
<Card.Root class="panel">
	<Card.Title>Map a Saved Secret</Card.Title>
	<form method="POST" action="?/saveMapping" use:enhance={secretForm} class="space-y-4">
		<div class="grid gap-4 lg:grid-cols-3">
			<div class="space-y-2">
				<label for="mapping-repository">Repository</label>
				<select id="mapping-repository" name="repository" class={selectClass} required>
					<option value="">Choose a repository</option>
					{#each data.repositories as repository (repository.path)}
						<option value={repository.path}>{repository.name}</option>
					{/each}
				</select>
			</div>
			<div class="space-y-2">
				<label for="mapping-variable">Environment variable</label>
				<Input
					id="mapping-variable"
					name="variable"
					placeholder="OPENAI_API_KEY"
					required
					pattern="[A-Za-z_][A-Za-z0-9_]*"
					autocomplete="off"
					spellcheck="false"
					class="font-mono"
				/>
			</div>
			<div class="space-y-2">
				<label for="mapping-secret">Saved secret</label>
				<select id="mapping-secret" name="secretId" class={selectClass} required>
					<option value="">Choose a saved secret</option>
					{#each data.secrets as secret (secret.id)}
						<option value={secret.id}>{secret.name}</option>
					{/each}
				</select>
			</div>
		</div>
		<Button type="submit" disabled={!data.repositories.length || !data.secrets.length}
			>Save mapping</Button
		>
	</form>
</Card.Root>

{#if !data.mappings.length}
	<p class="my-5 text-muted-foreground">
		No mappings yet. Keys are only supplied to repositories you map explicitly.
	</p>
{:else if !matchingMappings.length}
	<p class="my-5 text-muted-foreground">No mappings match your search.</p>
{:else}
	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-left text-sm">
			<thead class="bg-muted"
				><tr
					><th class="p-4">Repository</th><th class="p-4">Environment variable</th><th class="p-4"
						>Saved secret</th
					><th class="p-4">Action</th></tr
				></thead
			>
			<tbody>
				{#each matchingMappings as mapping (JSON.stringify([mapping.repository, mapping.variable]))}
					<tr class="border-t">
						<td class="p-4"
							><span class="font-medium">{mapping.repository.split('/').at(-1)}</span>
							<div class="mt-1 text-xs text-muted-foreground">{mapping.repository}</div></td
						>
						<td class="p-4 font-mono">{mapping.variable}</td>
						<td class="p-4">{data.secrets.find((s) => s.id === mapping.secretId)?.name}</td>
						<td class="p-4">
							<form method="POST" action="?/deleteMapping" use:enhance={secretForm}>
								<input type="hidden" name="repository" value={mapping.repository} />
								<input type="hidden" name="variable" value={mapping.variable} />
								<Button type="submit" variant="outline">Remove mapping</Button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
<p class="mt-6 text-sm text-muted-foreground">
	Mappings are saved for the agent runner. They do not change a repository’s .env file or the
	environment of an already running process.
</p>
