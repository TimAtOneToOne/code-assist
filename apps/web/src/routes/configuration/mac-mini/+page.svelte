<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Mac mini · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}>
	← Configuration
</a>
<div class="eyebrow">HOST SETTINGS</div>
<h1>Mac mini</h1>
<p class="intro">Where Code Assist finds your repositories on Mia.</p>

<Card.Root class="panel">
	<Card.Header class="p-0">
		<Card.Title>Repositories</Card.Title>
		<Card.Description>The parent folder containing your synced repository clones.</Card.Description>
	</Card.Header>
	<Card.Content class="p-0">
		<form
			method="POST"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
				}}
			class="space-y-5"
		>
			<div class="space-y-2">
				<label class="text-sm font-medium" for="repository-root">Repository root folder</label>
				<Input
					id="repository-root"
					name="repositoryRoot"
					value={form?.repositoryRoot ?? data.config.repositoryRoot}
					required
					autocomplete="off"
					spellcheck="false"
					aria-invalid={form?.error ? 'true' : undefined}
					aria-describedby={form?.error ? 'repository-help repository-error' : 'repository-help'}
					class="font-mono"
				/>
				<p id="repository-help" class="text-sm">
					Use an absolute path on the Mac mini. The existing repository sync keeps these clones
					updated.
				</p>
			</div>
			{#if form?.error}
				<p id="repository-error" role="alert" class="text-destructive">{form.error}</p>
			{/if}
			<div class="flex items-center gap-4">
				<Button type="submit">Save settings</Button>
				{#if form?.saved}<span role="status" class="text-sm">Settings saved.</span>{/if}
			</div>
		</form>
	</Card.Content>
</Card.Root>
