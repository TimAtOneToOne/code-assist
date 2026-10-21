<script lang="ts">
	import type { WorkItem } from '@code-assist/intake';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Settings from '@lucide/svelte/icons/settings';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workflowBadgeVariant } from '#lib/workflow-status.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let linearForm: HTMLFormElement;
	let githubForm: HTMLFormElement;
	const actionFeedback: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'error') {
				toast.error('Could not complete the request. Please try again.');
				return;
			}
			if (result.type === 'failure')
				toast.error(result.data?.error ?? 'Could not complete the request.');
			if (result.type === 'success' && result.data?.message) toast.success(result.data.message);
			await update({ reset: false });
		};
	async function refreshResults() {
		try {
			await invalidateAll();
			toast.success('Results refreshed.');
		} catch {
			toast.error('Could not refresh results. Please try again.');
		}
	}
	const pausedStorageKey = 'code-assist:paused-work';
	let pausedIds = $state<string[]>([]);
	let preferencesReady = $state(false);
	const visibleIssues = $derived(data.issues.filter((item) => !pausedIds.includes(item.id)));
	const completedIssues = $derived(
		data.completedIssues.filter((item) => !pausedIds.includes(item.id))
	);
	const pausedIssues = $derived(
		[...data.issues, ...data.completedIssues].filter((item) => pausedIds.includes(item.id))
	);
	onMount(() => {
		try {
			const saved: unknown = JSON.parse(localStorage.getItem(pausedStorageKey) ?? '[]');
			if (Array.isArray(saved) && saved.every((id) => typeof id === 'string')) pausedIds = saved;
		} catch {
			toast.error('Could not load your Paused Work display preference.');
		} finally {
			preferencesReady = true;
		}
	});
	function togglePaused(id: string) {
		pausedIds = pausedIds.includes(id)
			? pausedIds.filter((value) => value !== id)
			: [...pausedIds, id];
		try {
			localStorage.setItem(pausedStorageKey, JSON.stringify(pausedIds));
		} catch {
			toast.error('This view changed, but your browser could not save it for next time.');
		}
	}
	const date = (value: string | Date) =>
		new Date(value).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	const codingLabel = {
		prepare: 'Preparing Workspace',
		implement: 'Codex Implementing',
		checkpoint: 'Saving Code Checkpoint',
		collect: 'Collecting Saved Evidence',
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
<div class="mb-7 flex flex-wrap items-start justify-between gap-4">
	<h1>Your Workspace</h1>
	<div class="ml-auto flex flex-col items-end gap-2">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger class={buttonVariants({ variant: 'outline', class: 'gap-3 px-3' })}>
				Actions <ChevronDown class="size-4" aria-hidden="true" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-60">
				<DropdownMenu.Item onSelect={() => linearForm.requestSubmit()} disabled={!data.settings}>
					Check Linear Now
				</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => githubForm.requestSubmit()}
					>Refresh GitHub</DropdownMenu.Item
				>
				<DropdownMenu.Item onSelect={refreshResults}>
					<RefreshCw class="size-4" aria-hidden="true" /> Refresh Results
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a {...props} href={resolve('/configuration/intake')}>
							<Settings class="size-4" aria-hidden="true" /> Intake Settings
						</a>
					{/snippet}
				</DropdownMenu.Item>
				{#if data.settings}
					<DropdownMenu.Separator />
					<p class="px-2 py-1.5 text-xs text-muted-foreground">
						{data.settings.pollMinutes
							? `Checks every ${data.settings.pollMinutes} minutes.`
							: 'Checks run when requested.'}
						New tickets need Plan without Code.
					</p>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<p class="text-right text-xs text-muted-foreground" aria-live="polite">
			{#if !data.settings}
				<a class="underline underline-offset-4" href={resolve('/configuration/intake')}
					>Set Up Linear Intake</a
				>
			{:else if data.scan}
				{data.scan.status === 'completed' ? 'Linear checked' : `Linear check ${data.scan.status}`} · {date(
					data.scan.created_at
				)}{#if data.scan.issue_count !== null}{` · ${data.scan.issue_count} tickets`}{/if}
			{:else}No Linear check yet{/if}
		</p>
	</div>
</div>
<form
	bind:this={linearForm}
	method="POST"
	action="?/check"
	use:enhance={actionFeedback}
	hidden
></form>
<form
	bind:this={githubForm}
	method="POST"
	action="?/github"
	use:enhance={actionFeedback}
	hidden
></form>
{#if data.scan?.error}<p role="alert" class="mb-4 text-destructive">{data.scan.error}</p>{/if}
{#if data.notifications.length}
	<Card.Root class="panel"
		><Card.Title>{data.notifications.length} attention notification(s) pending</Card.Title>
		{#each data.notifications as notification (notification.id)}<p class="text-sm">
				{notification.error ?? 'Waiting for the notification worker.'} Attempts: {notification.attempts}
			</p>{/each}
		<form method="POST" action="?/notifications" use:enhance={actionFeedback}>
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
{#if !visibleIssues.length}<Card.Root class="panel"
		><Card.Title>No active tickets.</Card.Title>
		<p>
			{pausedIssues.length || completedIssues.length
				? 'Your paused or older completed tickets are below.'
				: 'Run a Linear check to bring in tickets labeled Plan.'}
		</p></Card.Root
	>{/if}
{#snippet ticketCard(item: WorkItem, paused = false, canPause = true)}
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
		<div class="flex shrink-0 items-center gap-2">
			{#if canPause}
				<Button
					variant="ghost"
					size="icon-sm"
					disabled={!preferencesReady}
					aria-label={`${paused ? 'Resume Work' : 'Pause Work'} for ${item.ticket.identifier}`}
					title={paused ? 'Return to Tickets' : 'Move to Paused Work (display only)'}
					onclick={() => togglePaused(item.id)}
				>
					{#if paused}<Play class="size-4" aria-hidden="true" />{:else}<Pause
							class="size-4"
							aria-hidden="true"
						/>{/if}
				</Button>
			{/if}
			<Button href={resolve('/tickets/[id]', { id: item.id })} variant="outline" size="sm"
				>Review ticket →</Button
			>
		</div>
	</Card.Root>
{/snippet}
{#each visibleIssues as item (item.id)}{@render ticketCard(item)}{/each}
<p class="mt-5 text-sm text-muted-foreground">
	Codex drafts and revises plans; Claude reviews them. You approve the exact plan before
	implementation.
</p>

{#if pausedIssues.length}
	<details class="group mt-8 rounded-xl border bg-card">
		<summary
			class="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
		>
			<span class="text-lg font-semibold">Paused Work</span>
			<Badge variant="secondary">{pausedIssues.length}</Badge>
			<ChevronDown
				class="ml-auto size-4 transition-transform group-open:rotate-180"
				aria-hidden="true"
			/>
		</summary>
		<div class="px-4 pb-3">
			<p class="mb-3 text-sm text-muted-foreground">
				Saved in this browser. This only changes your view; running jobs continue.
			</p>
			{#each pausedIssues as item (item.id)}{@render ticketCard(item, true)}{/each}
		</div>
	</details>
{/if}

{#if completedIssues.length}
	<details class="group mt-8 rounded-xl border bg-card">
		<summary
			class="flex cursor-pointer list-none items-center gap-3 rounded-xl px-4 py-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
		>
			<span class="text-lg font-semibold">Completed</span>
			<Badge variant="secondary">{completedIssues.length}</Badge>
			<ChevronDown
				class="ml-auto size-4 transition-transform group-open:rotate-180"
				aria-hidden="true"
			/>
		</summary>
		<div class="px-4 pb-3">
			<p class="mb-3 text-sm text-muted-foreground">Done for more than 24 hours.</p>
			{#each completedIssues as item (item.id)}{@render ticketCard(item, false, false)}{/each}
		</div>
	</details>
{/if}
