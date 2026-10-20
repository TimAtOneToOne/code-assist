<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import SecretEditor from '#lib/components/secret-editor.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
</script>

<svelte:head><title>Secrets & Environment · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Secrets & Environment</h1>
<p class="intro">Save shared keys, then map them to each repository’s environment variables.</p>

<form method="POST" action="?/consolidate" use:enhance class="mb-6 space-y-2">
	<Button type="submit" variant="outline">Consolidate Duplicate Secrets</Button>
	<p class="text-sm text-muted-foreground">
		Combine identical values into one saved secret and keep all mappings. Future rotations apply to
		every mapping that shares it.
	</p>
</form>
{#if form?.consolidated}
	<p role="status" class="mb-5">
		{form.consolidated.removed === 0
			? 'No duplicate secrets found.'
			: `Consolidated ${form.consolidated.removed} duplicate secrets and updated ${form.consolidated.mappingsUpdated} mappings.`}
	</p>
{/if}

{#if form?.error}<p role="alert" class="mb-5 text-destructive">{form.error}</p>{/if}
{#if form?.saved}<p role="status" class="mb-5">Configuration saved.</p>{/if}

<h2 class="mb-4 text-xl font-semibold">Saved Secrets</h2>
<div class="grid gap-5 xl:grid-cols-2">
	{#each data.secrets as secret (secret.id + secret.updatedAt)}
		<SecretEditor {secret} />
	{/each}
	<SecretEditor />
</div>

<h2 class="mt-8 mb-4 text-xl font-semibold">Repository Environment Mappings</h2>
<p class="mb-5 text-muted-foreground">
	Choose which saved key supplies each variable. Saving an existing repository and variable updates
	its mapping. Rotating a secret updates all mappings that use it.
</p>
{#if data.repositoryError}
	<p role="alert" class="mb-5 text-destructive">
		{data.repositoryError}
		<a class="underline" href={resolve('/configuration/mac-mini')}>Mac mini settings</a>
	</p>
{/if}
<Card.Root class="panel">
	<Card.Title>Map a Saved Secret</Card.Title>
	<form method="POST" action="?/saveMapping" use:enhance class="space-y-4">
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
				{#each data.mappings as mapping (JSON.stringify([mapping.repository, mapping.variable]))}
					<tr class="border-t">
						<td class="p-4"
							><span class="font-medium">{mapping.repository.split('/').at(-1)}</span>
							<div class="mt-1 text-xs text-muted-foreground">{mapping.repository}</div></td
						>
						<td class="p-4 font-mono">{mapping.variable}</td>
						<td class="p-4">{data.secrets.find((s) => s.id === mapping.secretId)?.name}</td>
						<td class="p-4">
							<form method="POST" action="?/deleteMapping" use:enhance>
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
