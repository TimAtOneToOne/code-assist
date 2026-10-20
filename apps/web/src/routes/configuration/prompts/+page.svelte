<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { promptDefinitions, type PromptScope } from '@code-assist/intake/prompt-defaults';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let search = $state('');
	const scopes = ['global', 'planning', 'coding'] as const;
	const tasks = ['discovery', 'draft', 'review'] as const;
	const repositoryName = $derived(
		data.repositories.find((repo) => repo.path === data.repository)?.name
	);
	const filtered = $derived(
		data.repositories.filter((repo) => repo.name.toLowerCase().includes(search.toLowerCase()))
	);
	function link(scope: PromptScope, repository?: string) {
		const params = new SvelteURLSearchParams({ scope });
		if (repository) params.set('repository', repository);
		return `${resolve('/configuration/prompts')}?${params}`;
	}
</script>

<svelte:head><title>Prompt Management · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Prompt Management</h1>
<p class="intro">
	Shape how your agents work. Saved changes apply when the next agent step starts, including
	retries. Running steps and saved plans keep their existing instructions and content.
</p>

<div class="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
	<nav aria-label="Prompt selection" class="space-y-5">
		<div>
			<h2 class="mb-2 text-sm font-semibold">Workspace Prompts</h2>
			<div class="flex flex-col gap-1">
				{#each scopes as scope (scope)}
					<Button
						href={link(scope)}
						variant={data.scope === scope && !data.repository ? 'secondary' : 'ghost'}
						class="justify-start"
						aria-current={data.scope === scope && !data.repository ? 'page' : undefined}
						>{promptDefinitions[scope].title}</Button
					>
				{/each}
			</div>
		</div>
		<div>
			<h2 class="mb-2 text-sm font-semibold">Agent Task Prompts</h2>
			<div class="flex flex-col gap-1">
				{#each tasks as scope (scope)}
					<Button
						href={link(scope)}
						variant={data.scope === scope && !data.repository ? 'secondary' : 'ghost'}
						class="justify-start"
						aria-current={data.scope === scope && !data.repository ? 'page' : undefined}
						>{promptDefinitions[scope].title}</Button
					>
				{/each}
			</div>
		</div>
		<div class="space-y-2">
			<h2 class="text-sm font-semibold">Repository Prompts</h2>
			<Input aria-label="Find a repository" placeholder="Find a repository…" bind:value={search} />
			<div class="max-h-64 overflow-y-auto">
				{#each filtered as repo (repo.path)}
					<Button
						href={link('global', repo.path)}
						variant={data.repository === repo.path ? 'secondary' : 'ghost'}
						class="h-auto min-h-9 w-full justify-start text-left break-all whitespace-normal"
						aria-current={data.repository === repo.path ? 'true' : undefined}>{repo.name}</Button
					>
				{:else}
					<p class="py-3 text-sm text-muted-foreground">No repositories found.</p>
				{/each}
			</div>
		</div>
	</nav>

	<Card.Root class="gap-4 p-5">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<Card.Title>{repositoryName ? `${repositoryName} · ` : ''}{data.definition.title}</Card.Title>
			<Badge variant="secondary"
				>{data.custom ? 'Custom' : data.repository ? 'Inherited' : 'Default'}</Badge
			>
		</div>
		{#if data.repository}
			<div class="flex flex-wrap gap-2" aria-label="Repository prompt scope">
				{#each scopes as scope (scope)}
					<Button
						size="sm"
						href={link(scope, data.repository)}
						variant={data.scope === scope ? 'secondary' : 'outline'}
						aria-current={data.scope === scope ? 'page' : undefined}
						>{promptDefinitions[scope].title}</Button
					>
				{/each}
			</div>
			<p class="text-sm text-muted-foreground">
				Add guidance for this repository. Workspace prompts still apply. These instructions refine
				them only for this repository, even on tickets involving several repositories.
			</p>
		{:else}
			<Card.Description>{data.definition.description}</Card.Description>
		{/if}
		{#if data.scope === 'coding'}
			<p class="text-sm text-muted-foreground">
				Coding prompts are saved for later. The coding runner is not implemented yet.
			</p>
		{/if}
		{#key `${data.scope}:${data.repository ?? ''}:${data.text}:${data.custom}`}
			<form
				method="POST"
				action={`${link(data.scope, data.repository)}&/save`}
				use:enhance
				class="space-y-4"
			>
				<input type="hidden" name="scope" value={data.scope} />
				<input type="hidden" name="repository" value={data.repository ?? ''} />
				<label class="sr-only" for="prompt-text">Prompt instructions</label>
				<Textarea
					id="prompt-text"
					name="text"
					value={data.text}
					rows={16}
					class="field-sizing-fixed min-h-64 resize-y font-mono text-sm leading-relaxed"
					placeholder={data.repository
						? 'No additional repository instructions.'
						: 'No additional instructions.'}
				/>
				<div class="flex flex-wrap gap-2">
					<Button type="submit" name="intent" value="save">Save Prompt</Button>
					<Button
						type="submit"
						name="intent"
						value="reset"
						variant="outline"
						disabled={!data.custom}
						>{data.repository ? 'Clear Repository Prompt' : 'Restore Default'}</Button
					>
				</div>
			</form>
		{/key}
		{#if form?.saved && form.scope === data.scope && form.repository === data.repository}
			<p role="status" class="text-sm">
				{form.reset
					? 'Default instructions restored.'
					: 'Prompt saved. Applies to the next agent step.'}
			</p>
		{/if}
		{#if form?.error}<p role="alert" class="text-destructive">{form.error}</p>{/if}
		<p class="text-sm text-muted-foreground">
			Agents receive global → phase → task instructions, plus each selected repository’s global and
			phase guidance. More specific guidance takes precedence within its scope. Runtime permissions,
			approval requirements, output schemas, and ticket context remain managed by Code Assist. The
			full assembled prompt is recorded with each agent execution in Logs.
		</p>
	</Card.Root>
</div>
