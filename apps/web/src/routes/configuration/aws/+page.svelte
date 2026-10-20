<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const inputClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
	const keys = [
		{ key: 'accessKeySecretId', label: 'Source access key ID' },
		{ key: 'secretAccessKeySecretId', label: 'Source secret access key' }
	] as const;
	const fields = [
		{ key: 'accountId', label: 'Staging account ID', placeholder: '12-digit account ID' },
		{ key: 'roleArn', label: 'Read-only role ARN', placeholder: 'arn:aws:iam::…:role/…' },
		{ key: 'region', label: 'Region', placeholder: 'us-east-2' },
		{ key: 'profile', label: 'Agent AWS profile', placeholder: 'staging-agent-readonly' }
	] as const;
</script>

<svelte:head><title>AWS staging · Code Assist</title></svelte:head>
<a class="mb-5 inline-block text-sm text-muted-foreground" href={resolve('/configuration')}
	>← Configuration</a
>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>AWS staging</h1>
<p class="intro">Give Codex and Claude read-only staging evidence during planning.</p>
<Card.Root class="panel">
	<Card.Title>Planning connection</Card.Title>
	<p>
		Choose source keys from <a class="underline" href={resolve('/configuration/secrets')}
			>saved secrets</a
		>. Each draft and review receives a temporary session for this role. Changes take effect on the
		next planning step.
	</p>
	<form method="POST" action="?/save" use:enhance class="space-y-5">
		{#each keys as field (field.key)}
			<div class="space-y-2">
				<label for={field.key}>{field.label}</label>
				<select
					id={field.key}
					name={field.key}
					class={inputClass}
					required
					value={data.settings?.[field.key] ?? ''}
				>
					<option value="">Choose a saved secret</option>
					{#each data.secrets as secret (secret.id)}<option value={secret.id}>{secret.name}</option
						>{/each}
				</select>
			</div>
		{/each}
		{#each fields as field (field.key)}
			<div class="space-y-2">
				<label for={field.key}>{field.label}</label><input
					class={inputClass}
					id={field.key}
					name={field.key}
					placeholder={field.placeholder}
					required
					value={data.settings?.[field.key] ?? ''}
				/>
			</div>
		{/each}
		<Button type="submit">Save staging connection</Button>
		{#if form?.saved}<p role="status">Staging connection saved.</p>{/if}
	</form>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>Verify connection</Card.Title>
	<p>
		Assume the saved role and confirm the AWS identity. The role’s IAM policy determines which reads
		are permitted; this test does not change AWS resources or validate every permission.
	</p>
	<form method="POST" action="?/test" use:enhance>
		<Button type="submit" variant="outline" disabled={!data.settings}>Test saved connection</Button>
	</form>
	{#if form?.identity}<div role="status" class="space-y-2 text-sm">
			<p>Connected to staging account {form.identity.accountId} in {form.identity.region}.</p>
			<p class="break-all">{form.identity.arn}</p>
			<p>Test session expires {new Date(form.identity.expiresAt).toLocaleString()}.</p>
		</div>{/if}
	{#if form?.error}<p role="alert" class="text-destructive">{form.error}</p>{/if}
</Card.Root>
