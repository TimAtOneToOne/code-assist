<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import RepositoryPicker from '#lib/components/repository-picker.svelte';
	import Markdown from '#lib/components/markdown.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let selected = $derived(
		data.item.selected_repositories.length
			? [...data.item.selected_repositories]
			: data.item.suggestions.map((suggestion) => suggestion.repository.path)
	);
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
		Repositories saved. Planning has not started.
	</p>{/if}
{#if !data.item.eligible}<p class="mb-4">
		This ticket no longer matches Plan without Code. It remains tracked; no work has been cancelled
		or started.
	</p>{/if}
<Card.Root class="panel">
	<Card.Title>Choose repositories</Card.Title>
	<form method="POST" use:enhance class="space-y-4">
		<input type="hidden" name="updatedAt" value={data.item.ticket.updatedAt} />
		<RepositoryPicker repositories={data.repositories} bind:value={selected} />
		<Button type="submit" disabled={!selected.length}>Confirm repositories</Button>
	</form>
</Card.Root>
<Card.Root class="panel"
	><Card.Title>Ticket description</Card.Title>
	{#if data.descriptionHtml}<Markdown html={data.descriptionHtml} />{:else}<p>
			No description.
		</p>{/if}</Card.Root
>
{#each data.comments as comment (comment.id)}<Card.Root class="panel"
		><Card.Title>Linear comment</Card.Title>
		<Markdown html={comment.html} /></Card.Root
	>{/each}
<Card.Root class="panel"
	><Card.Title>History</Card.Title>
	{#each data.item.events as event, index (index)}<p class="text-sm">
			{new Date(event.created_at).toLocaleString()} · {event.type === 'repository_needed'
				? 'Waiting for repository selection'
				: `Repositories selected: ${(event.details.repositories ?? [event.details.repository])
						.map((path: string) => path.split('/').at(-1))
						.join(', ')}`}
		</p>{/each}
</Card.Root>
