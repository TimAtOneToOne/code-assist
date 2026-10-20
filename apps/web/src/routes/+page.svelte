<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const date = (value: string | Date) => new Date(value).toLocaleString();
</script>

<svelte:head><title>Home · Code Assist</title></svelte:head>
<div class="eyebrow">YOUR WORKSPACE</div>
<h1>Ready for your next decision.</h1>
<p class="intro">Plan tickets from Linear, with repository suggestions for your review.</p>
<div class="mb-6 flex flex-wrap gap-3">
	<form method="POST" action="?/check" use:enhance>
		<Button type="submit" disabled={!data.settings}>Check Linear now</Button>
	</form>
	<Button variant="outline" onclick={() => invalidateAll()}>Refresh results</Button>
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
	<Card.Root class="panel"
		><Card.Title>Latest Linear check: {data.scan.status}</Card.Title>
		<p>
			{date(data.scan.created_at)}{#if data.scan.issue_count !== null}
				· {data.scan.issue_count} tickets observed{/if}
		</p>
		{#if data.scan.error}<p role="alert" class="text-destructive">
				{data.scan.error}
			</p>{/if}</Card.Root
	>
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
<h2 class="mb-4 text-xl font-semibold">Tickets</h2>
{#if !data.issues.length}<Card.Root class="panel"
		><Card.Title>No tickets tracked yet.</Card.Title>
		<p>Run a Linear check to bring in tickets labeled Plan.</p></Card.Root
	>{/if}
{#each data.issues as item (item.id)}
	<Card.Root class="panel">
		<div class="flex flex-wrap items-center gap-3">
			<Badge variant={item.selected_repository ? 'secondary' : 'default'}
				>{item.selected_repository ? 'Repository selected' : 'Needs repository'}</Badge
			>
			{#if !item.eligible}<Badge variant="outline">Plan trigger no longer present</Badge>{/if}<span
				class="text-sm text-muted-foreground">{item.ticket.identifier}</span
			>
		</div>
		<Card.Title
			><a href={resolve('/tickets/[id]', { id: item.id })}>{item.ticket.title}</a></Card.Title
		>
		<p class="text-sm">
			{#if item.selected_repository}Selected: {item.selected_repository
					.split('/')
					.at(-1)}{:else if item.suggestions.length}Suggested: {item.suggestions
					.map((s) => s.repository.name)
					.join(', ')}{:else}No explicit repository reference found. Choose from Mia’s repositories.{/if}
		</p>
		<div>
			<Button href={resolve('/tickets/[id]', { id: item.id })} variant="outline"
				>Review ticket →</Button
			>
		</div>
	</Card.Root>
{/each}
<p class="mt-5 text-sm text-muted-foreground">
	Repository selection is the current step. Planning and implementation have not started.
</p>
