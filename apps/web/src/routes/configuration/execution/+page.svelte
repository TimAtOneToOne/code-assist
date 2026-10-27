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
<p class="intro">Choose how many tickets can go through discovery at the same time.</p>
<Card.Root class="max-w-2xl gap-5 p-5">
	<Card.Title>Discovery Parallelism</Card.Title>
	<Card.Description
		>Each slot covers one ticket’s repository setup and initial investigation. Additional tickets
		wait in the queue.</Card.Description
	>
	{#key data.settings.maxParallelDiscoveries}
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
			<Button type="submit">Save Execution Settings</Button>
		</form>
	{/key}
	{#if form?.saved}<p role="status" class="text-sm">
			Saved. Active discoveries will finish before the new maximum takes effect. No restart is
			needed.
		</p>{/if}
	{#if form?.error}<p role="alert" class="text-sm text-destructive">{form.error}</p>{/if}
	<p class="text-sm text-muted-foreground">
		When you change this setting, active discoveries finish normally before queued tickets start
		with the new maximum. Planning and coding use their separate queues.
	</p>
</Card.Root>
