<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Agent Execution · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Agent Execution</h1>
<p class="intro">Choose how many discovery and coding sessions can run at the same time.</p>
<Card.Root class="max-w-2xl gap-5 p-5">
	<Card.Title>Agent Parallelism</Card.Title>
	<Card.Description
		>Discovery and coding have separate limits. Additional tickets wait in their respective queues.</Card.Description
	>
	{#key JSON.stringify(data.settings)}
		<form method="POST" action="?/save" use:enhance class="space-y-5">
			<div class="space-y-2">
				<label for="parallel-discoveries" class="text-sm font-medium"
					>Maximum Parallel Discoveries</label
				>
				<Input
					id="parallel-discoveries"
					name="maxParallelDiscoveries"
					type="number"
					min="1"
					step="1"
					required
					value={data.settings.maxParallelDiscoveries}
					aria-describedby="parallel-description"
					class="max-w-32"
				/>
				<p id="parallel-description" class="text-sm text-muted-foreground">
					Default: 3. Higher values let more tickets start together and use more of Mia’s resources.
				</p>
			</div>
			<div class="space-y-2">
				<label for="parallel-coding" class="text-sm font-medium"
					>Maximum Parallel Coding Sessions</label
				>
				<Input
					id="parallel-coding"
					name="maxParallelCodingSessions"
					type="number"
					min="1"
					step="1"
					required
					value={data.settings.maxParallelCodingSessions}
					aria-describedby="coding-description"
					class="max-w-32"
				/>
				<p id="coding-description" class="text-sm text-muted-foreground">
					Default: 3. Each ticket keeps its own workspace. Setup, coding, validation, acceptance,
					review, and publication share this limit; steps within a ticket stay sequential. Higher
					values use more of Mia’s resources.
				</p>
			</div>
			<Button type="submit">Save Execution Settings</Button>
		</form>
	{/key}
	{#if form?.saved}<p role="status" class="text-sm">
			Saved. Active steps finish normally before a changed maximum takes effect. No restart is
			needed.
		</p>{/if}
	{#if form?.error}<p role="alert" class="text-sm text-destructive">{form.error}</p>{/if}
	<p class="text-sm text-muted-foreground">
		When a limit changes, active steps in that queue finish before queued work starts with the new
		maximum. Planning uses its separate queue.
	</p>
</Card.Root>
