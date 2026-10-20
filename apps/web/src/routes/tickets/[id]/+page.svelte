<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import RepositoryPicker from '#lib/components/repository-picker.svelte';
	import Markdown from '#lib/components/markdown.svelte';
	import DiscoveryPanel from '#lib/components/discovery-panel.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let discovery = $derived(
		data.item.discoveries.find((run) => run.id === data.item.current_discovery_id)
	);
	const phase = {
		queued: ['Codex discovery is queued', 'Codex inspects the ticket and repository scope'],
		running: ['Codex is investigating', 'You review the findings and answer open questions'],
		questions: ['Your scope confirmation is needed', 'Your answers become the planning baseline'],
		ready: ['Scope and answers are saved', 'Full planning cycle — not started yet'],
		failed: ['Initial discovery needs attention', 'Review the failure and retry'],
		superseded: [
			'Previous discovery is no longer current',
			'Eligible tickets resume with their current scope'
		]
	};
	function eventText(event: {
		type: string;
		details: { repositories?: string[]; repository?: string };
	}) {
		const labels: Record<string, string> = {
			repository_needed: 'Waiting for repository selection',
			issue_removed: 'Removed: Plan label removed in Linear',
			issue_restored: 'Restored: Plan label added in Linear',
			discovery_queued: 'Codex initial discovery queued',
			discovery_started: 'Codex started reading the ticket and repositories',
			discovery_questions: 'Codex findings and questions ready for review',
			discovery_answered: 'You confirmed scope and saved the planning answers',
			discovery_failed: 'Initial discovery failed',
			discovery_superseded: 'Earlier discovery replaced after scope or ticket changes',
			discovery_interrupted: 'Discovery interrupted; checkpoint queued for the next worker'
		};
		return (
			labels[event.type] ??
			(event.type === 'repositories_selected' || event.type === 'repository_selected'
				? `Repositories selected: ${(event.details.repositories ?? [event.details.repository ?? '']).map((path) => path.split('/').at(-1)).join(', ')}`
				: event.type)
		);
	}
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
	{#if data.item.removed_at}<Badge variant="outline">Removed</Badge>{/if}
	{#each data.item.ticket.labels as label (label)}<Badge variant="secondary">{label}</Badge>{/each}
</div>
{#if form?.error}<p role="alert" class="mb-4 text-destructive">{form.error}</p>{/if}
{#if form?.message}<p role="status" class="mb-4">{form.message}</p>{/if}
{#if data.item.removed_at}<p class="mb-4">
		Removed from Home because the Plan label was removed in Linear. History and repository
		selections are saved. Adding Plan back restores this ticket on the next check.
	</p>
{:else if !data.item.eligible}<p class="mb-4">
		This ticket no longer matches Plan without Code. Initial discovery is paused.
	</p>{/if}
{#if discovery && !data.item.removed_at}
	<div class="mb-5 flex flex-wrap gap-x-8 gap-y-2 text-sm">
		<div><span class="mr-2 font-semibold">Now</span>{phase[discovery.status][0]}</div>
		<div><span class="mr-2 font-semibold">Next</span>{phase[discovery.status][1]}</div>
	</div>
	<DiscoveryPanel
		run={discovery}
		summaryHtml={data.discoverySummaries[discovery.id] ?? ''}
		editable={data.item.eligible}
	/>
{/if}
{#if !data.item.removed_at}<Card.Root class="panel">
		<details open={!data.item.selected_repositories.length}>
			<summary class="cursor-pointer font-medium"
				>{data.item.selected_repositories.length
					? `Repository scope · ${data.item.selected_repositories.map((path) => path.split('/').at(-1)).join(', ')}`
					: 'Choose repositories'}</summary
			>
			<form method="POST" use:enhance class="space-y-4">
				<input type="hidden" name="updatedAt" value={data.item.ticket.updatedAt} />
				<RepositoryPicker repositories={data.repositories} bind:value={selected} />
				<Button type="submit" disabled={!selected.length}>Confirm repositories</Button>
			</form>
		</details>
	</Card.Root>{/if}
{#each data.item.discoveries.filter((run) => run.id !== discovery?.id || data.item.removed_at) as previous (previous.id)}
	<details class="mb-5">
		<summary class="cursor-pointer text-sm text-muted-foreground"
			>Earlier discovery · {new Date(previous.created_at).toLocaleString()} · {previous.status}</summary
		>
		<DiscoveryPanel
			run={previous}
			summaryHtml={data.discoverySummaries[previous.id] ?? ''}
			editable={false}
		/>
	</details>
{/each}
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
			{new Date(event.created_at).toLocaleString()} · {eventText(event)}
		</p>{/each}
</Card.Root>
