<script lang="ts">
	import type { WorkItem } from '@code-assist/intake';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workflowBadgeVariant } from '#lib/workflow-status.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const date = (value: string | Date) => new Date(value).toLocaleString();
	const codingLabel = {
		prepare: 'Preparing Workspace',
		implement: 'Codex Implementing',
		validate: 'Running Validation',
		review: 'Claude Reviewing',
		publish: 'Publishing PR',
		failed: 'Coding Needs Attention',
		needs_direction: 'Coding Needs Direction',
		pr_open: 'Pull Request Open',
		pr_closed: 'Closed Without Merge',
		awaiting_main: 'Waiting for Main Workflow',
		main_running: 'Main Workflows Running',
		main_failed: 'Main Workflow Failed',
		done: 'Done',
		superseded: 'Coding Paused'
	};
	const planningLabel = {
		drafting: 'Codex Drafting',
		reviewing: 'Claude Reviewing',
		revising: 'Codex Revising',
		awaiting_approval: 'Review Plan',
		needs_direction: 'Planning Needs Direction',
		approved: 'Plan Approved',
		failed: 'Planning Failed',
		superseded: 'Planning Paused'
	};
	const discoveryLabel = {
		queued: 'Discovery Queued',
		running: 'Codex Investigating',
		questions: 'Review Discovery',
		ready: 'Ready for Planning',
		failed: 'Discovery Failed',
		superseded: 'Discovery Paused'
	};
</script>

<svelte:head><title>Home · Code Assist</title></svelte:head>
<div class="eyebrow">YOUR WORKSPACE</div>
<h1>Ready for your next decision.</h1>
<p class="intro">Plan tickets, agent investigations, and plans awaiting your decision.</p>
<div class="mb-6 flex flex-wrap gap-3">
	<form method="POST" action="?/check" use:enhance>
		<Button type="submit" disabled={!data.settings}>Check Linear now</Button>
	</form>
	<Button variant="outline" onclick={() => invalidateAll()}>Refresh results</Button>
	<form method="POST" action="?/github" use:enhance>
		<Button type="submit" variant="outline">Refresh GitHub</Button>
	</form>
	<Button href={resolve('/configuration/intake')} variant="outline">Intake settings</Button>
</div>
{#if form?.error}<p role="alert" class="mb-4 text-destructive">{form.error}</p>{/if}
{#if form?.message}<p role="status" class="mb-4">{form.message}</p>{/if}
{#if !data.settings}<p class="mb-5">
		Configure the Linear credential and attention flow to start intake.
	</p>
{:else}<p class="mb-5 text-sm text-muted-foreground">
		{data.settings.pollMinutes
			? `Checks every ${data.settings.pollMinutes} minute(s).`
			: 'Checks run when requested.'} New tickets need Plan and must not have Code.
	</p>{/if}
{#if data.scan}
	<Card.Root class="mb-5 gap-2 px-4 py-3">
		<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<Card.Title class="text-sm">Latest Linear check: {data.scan.status}</Card.Title>
			<p class="text-sm">
				{date(data.scan.created_at)}{#if data.scan.issue_count !== null}
					· {data.scan.issue_count} tickets observed{/if}
			</p>
		</div>
		{#if data.scan.error}<p role="alert" class="text-destructive">
				{data.scan.error}
			</p>{/if}
	</Card.Root>
{/if}
{#if data.notifications.length}
	<Card.Root class="panel"
		><Card.Title>{data.notifications.length} attention notification(s) pending</Card.Title>
		{#each data.notifications as notification (notification.id)}<p class="text-sm">
				{notification.error ?? 'Waiting for the notification worker.'} Attempts: {notification.attempts}
			</p>{/each}
		<form method="POST" action="?/notifications" use:enhance>
			<Button type="submit" variant="outline">Retry pending notifications</Button>
		</form></Card.Root
	>
{/if}
<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
	<h2 class="text-xl font-semibold">Tickets</h2>
	<div class="flex gap-2" aria-label="Status Color Guide">
		<Badge variant="attention">Needs Your Attention</Badge>
		<Badge variant="active">Working or Done</Badge>
	</div>
</div>
{#if !data.issues.length}<Card.Root class="panel"
		><Card.Title>No active tickets.</Card.Title>
		<p>
			{data.completedIssues.length
				? 'Older completed tickets are below.'
				: 'Run a Linear check to bring in tickets labeled Plan.'}
		</p></Card.Root
	>{/if}
{#snippet ticketCard(item: WorkItem)}
	<Card.Root class="mb-2 gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
		<div class="min-w-0 space-y-1">
			<Card.Title
				><a href={resolve('/tickets/[id]', { id: item.id })}
					>{item.ticket.identifier}: {item.ticket.title}</a
				></Card.Title
			>
			<div class="flex flex-wrap items-center gap-2">
				<Badge
					variant={workflowBadgeVariant(
						item.coding_status ??
							item.planning_status ??
							item.discovery_status ??
							(item.selected_repositories.length ? null : 'needs_repositories'),
						item.eligible
					)}
					>{item.coding_status
						? codingLabel[item.coding_status]
						: item.planning_status
							? planningLabel[item.planning_status]
							: item.discovery_status
								? discoveryLabel[item.discovery_status]
								: item.selected_repositories.length
									? 'Repositories Selected'
									: 'Needs Repositories'}</Badge
				>
				{#if item.selected_repositories.length}
					{#each item.selected_repositories as repository (repository)}
						<Badge variant="secondary">{repository.split('/').at(-1)}</Badge>
					{/each}
				{:else}
					<p class="text-sm">
						{#if item.suggestions.length}Suggested: {item.suggestions
								.map((s) => s.repository.name)
								.join(', ')}{:else}No explicit repository reference found. Choose from Mia’s
							repositories.{/if}
					</p>
				{/if}
				{#if !item.eligible}<Badge variant="outline">Plan Trigger No Longer Present</Badge>{/if}
			</div>
		</div>
		<div class="shrink-0">
			<Button href={resolve('/tickets/[id]', { id: item.id })} variant="outline" size="sm"
				>Review ticket →</Button
			>
		</div>
	</Card.Root>
{/snippet}
{#each data.issues as item (item.id)}{@render ticketCard(item)}{/each}
<p class="mt-5 text-sm text-muted-foreground">
	Codex drafts and revises plans; Claude reviews them. You approve the exact plan before
	implementation.
</p>

{#if data.completedIssues.length}
	<details class="group mt-8 rounded-xl border bg-card">
		<summary
			class="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
		>
			<span class="text-lg font-semibold">Completed</span>
			<Badge variant="secondary">{data.completedIssues.length}</Badge>
			<ChevronDown
				class="ml-auto size-4 transition-transform group-open:rotate-180"
				aria-hidden="true"
			/>
		</summary>
		<div class="px-4 pb-3">
			<p class="mb-3 text-sm text-muted-foreground">Done for more than 24 hours.</p>
			{#each data.completedIssues as item (item.id)}{@render ticketCard(item)}{/each}
		</div>
	</details>
{/if}
