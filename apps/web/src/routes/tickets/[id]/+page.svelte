<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import TicketSection from '#lib/components/ticket-section.svelte';
	import RepositoryPicker from '#lib/components/repository-picker.svelte';
	import Markdown from '#lib/components/markdown.svelte';
	import PageJump from '#lib/components/page-jump.svelte';
	import CodingPanel from '#lib/components/coding-panel.svelte';
	import PlanningPanel from '#lib/components/planning-panel.svelte';
	import DiscoveryPanel from '#lib/components/discovery-panel.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let discovery = $derived(
		data.item.discoveries.find((run) => run.id === data.item.current_discovery_id)
	);
	let planning = $derived(
		data.item.planning.find((run) => run.discovery_id === data.item.current_discovery_id)
	);
	let labels = $derived(data.item.ticket.labels.filter((label) => label.toLowerCase() !== 'plan'));
	function eventText(event: {
		type: string;
		details: { repositories?: string[]; repository?: string };
	}) {
		const labels: Record<string, string> = {
			coding_direction_answered: 'You replied to the coding agent and continued the work',
			coding_changes_requested: 'You requested code changes on the existing PR',
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
<div class="ticket-header mb-8">
	<h1>{data.item.ticket.title}</h1>
	<div class="mt-4 flex items-baseline justify-between gap-4 text-sm text-muted-foreground">
		<span class="ticket-identifier">{data.item.ticket.identifier}</span>
		<!-- eslint-disable svelte/no-navigation-without-resolve -- Linear URLs are external. -->
		<a
			href={data.item.ticket.url}
			target="_blank"
			rel="noreferrer"
			class="shrink-0 text-sm text-muted-foreground underline underline-offset-4">Open in Linear</a
		>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
	{#if data.item.removed_at || labels.length}
		<div class="mt-4 flex flex-wrap gap-2">
			{#if data.item.removed_at}<Badge variant="outline">Removed</Badge>{/if}
			{#each labels as label (label)}<Badge variant="secondary">{label}</Badge>{/each}
		</div>
	{/if}
</div>
{#if form?.error}<p role="alert" class="mb-4 text-destructive">{form.error}</p>{/if}
{#if form?.message}<p role="status" class="mb-4">{form.message}</p>{/if}
{#if data.item.removed_at}<p class="mb-4">
		Removed from Home because the Plan label was removed in Linear. History and repository
		selections are saved. Adding Plan back restores this ticket on the next check.
	</p>
{:else if !data.item.eligible}<p class="mb-4">
		This ticket no longer matches Plan without Code. Agent work is paused.
	</p>{/if}
{#each data.item.coding as run (run.id)}<CodingPanel
		{run}
		editable={data.item.eligible &&
			!data.item.removed_at &&
			run.planning_id === planning?.id &&
			run.version === planning?.current_version &&
			planning?.status === 'approved'}
	/>{/each}
{#if planning && !data.item.removed_at}<PlanningPanel
		run={planning}
		html={data.planHtml}
		changes={data.planChanges}
		editable={data.item.eligible}
	/>{/if}
{#each data.item.planning.filter((run) => run.id !== planning?.id || data.item.removed_at) as previous (previous.id)}
	<PlanningPanel
		run={previous}
		html={data.planHtml}
		changes={data.planChanges}
		editable={false}
		title={'Earlier Planning · ' + new Date(previous.created_at).toLocaleString()}
	/>
{/each}
{#if discovery && !data.item.removed_at}
	<DiscoveryPanel
		run={discovery}
		summaryHtml={data.discoverySummaries[discovery.id] ?? ''}
		editable={data.item.eligible}
	/>
{/if}
{#if !data.item.removed_at}<TicketSection
		collapsed={!!data.item.selected_repositories.length}
		title={data.item.selected_repositories.length
			? 'Repository Scope · ' +
				data.item.selected_repositories.map((path) => path.split('/').at(-1)).join(', ')
			: 'Choose Repositories'}
	>
		<form method="POST" use:enhance class="space-y-4">
			<input type="hidden" name="updatedAt" value={data.item.ticket.updatedAt} />
			<RepositoryPicker repositories={data.repositories} bind:value={selected} />
			<Button type="submit" disabled={!selected.length}>Confirm Repositories</Button>
		</form>
	</TicketSection>{/if}
{#each data.item.discoveries.filter((run) => run.id !== discovery?.id || data.item.removed_at) as previous (previous.id)}
	<DiscoveryPanel
		run={previous}
		summaryHtml={data.discoverySummaries[previous.id] ?? ''}
		editable={false}
		title={'Earlier Discovery · ' + new Date(previous.created_at).toLocaleString()}
	/>
{/each}
<TicketSection title="Ticket Description" collapsed={!!discovery}>
	{#if data.descriptionHtml}<Markdown html={data.descriptionHtml} />{:else}<p>
			No description.
		</p>{/if}</TicketSection
>
{#each data.comments as comment (comment.id)}<TicketSection
		title="Linear Comment"
		collapsed={!!discovery}
	>
		<Markdown html={comment.html} /></TicketSection
	>{/each}
<TicketSection title="History" collapsed>
	{#each data.item.events as event, index (index)}<p class="text-sm">
			{new Date(event.created_at).toLocaleString()} · {eventText(event)}
		</p>{/each}
</TicketSection>

<PageJump />
