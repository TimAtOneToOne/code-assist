<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>{data.item.ticket.identifier} · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/')}>← Home</a>
<div class="eyebrow">{data.item.ticket.identifier}</div>
<h1>{data.item.ticket.title}</h1>
<p class="intro">
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Linear URLs are external. -->
	<a href={data.item.ticket.url} target="_blank" rel="noreferrer" class="underline"
		>Open in Linear</a
	>
</p>
<div class="mb-6 flex flex-wrap gap-2">
	{#each data.item.ticket.labels as label (label)}<Badge variant="secondary">{label}</Badge>{/each}
</div>
{#if form?.error}<p role="alert" class="mb-4 text-destructive">{form.error}</p>{/if}
{#if form?.saved}<p role="status" class="mb-4">
		Repository selected. Planning has not started.
	</p>{/if}
{#if !data.item.eligible}<p class="mb-4">
		This ticket no longer matches Plan without Code. It remains tracked; no work has been cancelled
		or started.
	</p>{/if}
<Card.Root class="panel">
	<Card.Title>Choose the repository</Card.Title>
	<Card.Description
		>One repository per ticket. Suggestions are references found in the ticket, not confirmed
		implementation scope.</Card.Description
	>
	{#each data.item.suggestions as suggestion (suggestion.repository.path)}
		<div class="rounded-md border p-4">
			<h2 class="font-semibold">{suggestion.repository.name}</h2>
			<ul class="mt-2 list-disc space-y-1 pl-5 text-sm">
				{#each suggestion.evidence as reason (reason)}<li>{reason}</li>{/each}
			</ul>
		</div>
	{:else}<p>No explicit repository reference was found. Select the repository below.</p>{/each}
	<form method="POST" use:enhance class="space-y-4">
		<input type="hidden" name="updatedAt" value={data.item.ticket.updatedAt} />
		<label class="block" for="repository">Repository</label>
		<select
			id="repository"
			name="repository"
			required
			class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
			value={data.item.selected_repository ?? ''}
		>
			<option value="">Choose a repository</option>
			{#each data.repositories as repository (repository.path)}<option value={repository.path}
					>{repository.name}</option
				>{/each}
		</select><Button type="submit">Confirm repository</Button>
	</form>
	{#if data.item.selected_repository}<p class="text-sm">
			Selected: <span class="font-mono">{data.item.selected_repository}</span>
		</p>{/if}
</Card.Root>
<Card.Root class="panel"
	><Card.Title>Ticket description</Card.Title>
	<div class="text-sm leading-relaxed break-words whitespace-pre-wrap">
		{data.item.ticket.description || 'No description.'}
	</div></Card.Root
>
{#each data.item.ticket.comments as comment (comment.id)}<Card.Root class="panel"
		><Card.Title>Linear comment</Card.Title>
		<div class="text-sm leading-relaxed break-words whitespace-pre-wrap">
			{comment.body}
		</div></Card.Root
	>{/each}
<Card.Root class="panel"
	><Card.Title>History</Card.Title>
	{#each data.item.events as event, index (index)}<p class="text-sm">
			{new Date(event.created_at).toLocaleString()} · {event.type === 'repository_needed'
				? 'Waiting for repository selection'
				: `Repository selected: ${event.details.repository}`}
		</p>{/each}
</Card.Root>
