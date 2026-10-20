<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	function query(offset: number) {
		return (
			'?' +
			new URLSearchParams({
				attempt: data.filters.attempt,
				service: data.filters.service,
				start: String(data.filters.start),
				end: String(data.filters.end),
				offset: String(offset)
			})
		);
	}
	function timestamp(value: unknown) {
		return typeof value === 'number'
			? new Date(value / 1000).toLocaleString()
			: String(value ?? '');
	}
</script>

<svelte:head><title>Logs · Code Assist</title></svelte:head>
<div class="eyebrow">OBSERVABILITY</div>
<h1>Logs</h1>
<p class="intro">Follow an attempt from its first event to the evidence behind a failure.</p>

<Card.Root class="panel mb-6">
	<Card.Header class="p-0">
		<Card.Title>Find an attempt</Card.Title>
		<Card.Description
			>Search all retained history. Results show 100 events per page, newest first.</Card.Description
		>
	</Card.Header>
	<Card.Content class="p-0">
		<form method="GET" action={resolve('/logs')} class="flex flex-wrap items-end gap-4">
			<div class="min-w-64 flex-1 space-y-2">
				<label for="attempt" class="text-sm font-medium">Attempt ID</label>
				<Input
					id="attempt"
					name="attempt"
					value={data.filters.attempt}
					placeholder="All attempts"
					class="font-mono"
				/>
			</div>
			<div class="space-y-2">
				<label for="service" class="text-sm font-medium">Service</label>
				<Input
					id="service"
					name="service"
					value={data.filters.service}
					placeholder="All services"
				/>
			</div>
			<Button type="submit">Search / refresh</Button>
		</form>
	</Card.Content>
</Card.Root>
{#if data.partial}
	<p role="alert" class="mb-4 text-destructive">
		OpenObserve returned partial results. This is incomplete evidence; repeat the search or inspect
		the local files.
	</p>
{/if}
<div class="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
	<span>{data.rows.length} events · through {new Date(data.filters.end).toLocaleString()}</span>
	<Button variant="link" href={resolve('/api/logs') + query(data.filters.offset)}
		>JSON for agents</Button
	>
</div>
{#if data.rows.length === 0}
	<Card.Root class="panel"
		><Card.Content class="p-0"
			>No matching events have been indexed. Recent events may still be arriving.</Card.Content
		></Card.Root
	>
{:else}
	<div class="space-y-3">
		{#each data.rows as row, index (`${row.event_id ?? row._timestamp}-${index}`)}
			<details class="rounded-lg border border-border bg-card px-5 py-4">
				<summary class="cursor-pointer space-y-2">
					<span class="ml-2 text-xs text-muted-foreground"
						>{timestamp(row._timestamp)} · {String(row.service ?? 'process')} · {String(
							row.level ?? 'info'
						)}</span
					>
					<span class="block font-medium break-words"
						>{String(row.body ?? row.message ?? row.event ?? 'Log event')}</span
					>
					{#if row.attempt_id}<span class="block font-mono text-xs text-muted-foreground"
							>{String(row.attempt_id)}</span
						>{/if}
				</summary>
				<div class="mt-4 space-y-3">
					{#if typeof row.artifact_id === 'string'}
						<Button variant="outline" href={resolve('/api/artifacts/[id]', { id: row.artifact_id })}
							>Download complete payload ({String(row.artifact_bytes)} bytes)</Button
						>
					{/if}
					<pre
						class="overflow-auto rounded bg-muted p-4 text-xs break-all whitespace-pre-wrap">{JSON.stringify(
							row,
							null,
							2
						)}</pre>
				</div>
			</details>
		{/each}
	</div>
{/if}
<div class="mt-6 flex items-center gap-3">
	{#if data.filters.offset > 0}
		<Button
			variant="outline"
			href={resolve('/logs') + query(Math.max(0, data.filters.offset - 100))}>Previous page</Button
		>
	{/if}
	{#if data.nextOffset !== null}
		<Button variant="outline" href={resolve('/logs') + query(data.nextOffset)}>Next page</Button>
	{/if}
</div>
