<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
	const fields = [
		{ key: 'linearSecretId', label: 'Linear credential' },
		{ key: 'teamsWebhookSecretId', label: 'Power Automate flow URL' },
		{ key: 'teamsConversationSecretId', label: 'Teams conversation ID' }
	] as const;
</script>

<svelte:head><title>Ticket Intake · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Ticket Intake</h1>
<p class="intro">Read Plan tickets from Linear and send attention links to Teams.</p>
<Card.Root class="panel">
	<Card.Title>Connections and Schedule</Card.Title>
	<p>
		Choose credentials from <a href={resolve('/configuration/secrets')} class="underline"
			>saved secrets</a
		>. Repository selection remains yours; this step does not start an agent or change Linear
		tickets.
	</p>
	<form method="POST" use:enhance class="space-y-5">
		{#each fields as field (field.key)}
			<div class="space-y-2">
				<label for={field.key}>{field.label}</label>
				<select
					id={field.key}
					name={field.key}
					class={selectClass}
					required
					value={data.settings?.[field.key] ?? ''}
				>
					<option value="">Choose a saved secret</option>
					{#each data.secrets as secret (secret.id)}<option value={secret.id}>{secret.name}</option
						>{/each}</select
				>
			</div>
		{/each}
		<div class="space-y-2">
			<label for="linearTokenType">Linear token type</label>
			<select
				id="linearTokenType"
				name="linearTokenType"
				class={selectClass}
				value={data.settings?.linearTokenType ?? 'apiKey'}
				><option value="apiKey">Personal API key</option><option value="accessToken"
					>OAuth access token</option
				></select
			>
		</div>
		<div class="space-y-2">
			<label for="pollMinutes">Check Linear</label>
			<select
				id="pollMinutes"
				name="pollMinutes"
				class={selectClass}
				value={data.settings?.pollMinutes ?? 5}
				><option value="5">Every five minutes</option><option value="1">Every minute</option><option
					value="0">Only when requested</option
				></select
			>
		</div>
		<Button type="submit">Save intake settings</Button>
		{#if form?.error}<p role="alert" class="text-destructive">{form.error}</p>{/if}
		{#if form?.saved}<p role="status">Intake settings saved.</p>{/if}
	</form>
</Card.Root>
