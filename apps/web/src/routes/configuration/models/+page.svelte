<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const codexSuggestions = [
		'gpt-6.1-sol',
		'gpt-6-astra',
		'gpt-6-sol',
		'gpt-6-luna',
		'gpt-5.6-sol',
		'gpt-5.6-terra',
		'gpt-5.6-luna',
		'gpt-5.5'
	];
	const claudeSuggestions = [
		'claude-opus-5-5',
		'claude-sonnet-5-5',
		'claude-haiku-5-5',
		'claude-opus-5',
		'claude-sonnet-5',
		'claude-opus-4-8',
		'claude-sonnet-4-6'
	];
</script>

<svelte:head><title>Agent Models · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Agent Models</h1>
<p class="intro">
	Choose the model each provider uses. Changes apply to the next agent step, including retries.
	Running steps keep their selected model.
</p>
<Card.Root class="max-w-2xl gap-5 p-5">
	<Card.Title>Model Selection</Card.Title>
	<Card.Description
		>Choose a suggestion or enter a model ID. Suggestions were verified on October 20, 2026; access
		depends on the saved provider account.</Card.Description
	>
	{#key `${data.settings.codex}:${data.settings.claude}`}
		<form method="POST" action="?/save" use:enhance class="space-y-6">
			<div class="space-y-2">
				<label for="codex-model" class="text-sm font-medium">Codex Model</label>
				<Input
					id="codex-model"
					name="codex"
					value={data.settings.codex}
					list="codex-models"
					required
					autocomplete="off"
					spellcheck={false}
					aria-describedby="codex-description"
				/>
				<datalist id="codex-models"
					>{#each codexSuggestions as model (model)}<option value={model}></option>{/each}</datalist
				>
				<p id="codex-description" class="text-sm text-muted-foreground">
					Used for initial discovery and plan drafting and revision. This selection will also be
					used by the coding runner when it is added.
				</p>
			</div>
			<div class="space-y-2">
				<label for="claude-model" class="text-sm font-medium">Claude Model</label>
				<Input
					id="claude-model"
					name="claude"
					value={data.settings.claude}
					list="claude-models"
					required
					autocomplete="off"
					spellcheck={false}
					aria-describedby="claude-description"
				/>
				<datalist id="claude-models"
					>{#each claudeSuggestions as model (model)}<option value={model}
						></option>{/each}</datalist
				>
				<p id="claude-description" class="text-sm text-muted-foreground">
					Used for adversarial plan review.
				</p>
			</div>
			<Button type="submit">Save Models</Button>
		</form>
	{/key}
	{#if form?.saved}<p role="status" class="text-sm">
			Models saved. Applies to the next agent step.
		</p>{/if}
	{#if form?.error}<p role="alert" class="text-sm text-destructive">{form.error}</p>{/if}
	<p class="text-sm text-muted-foreground">
		Reasoning and effort use provider defaults. Selected models are recorded in Logs. Saving does
		not run a model availability test; an unavailable model will fail the step with diagnostics.
	</p>
</Card.Root>
