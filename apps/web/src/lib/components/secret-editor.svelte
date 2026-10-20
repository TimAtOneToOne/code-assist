<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SecretMetadata } from '@code-assist/secrets';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	let { secret }: { secret?: SecretMetadata } = $props();
	let value = $state('');
	let revealed = $state(false);
	let loading = $state(false);
	let revealError = $state('');
	const fieldId = $derived(secret?.id ?? 'new-secret');

	async function toggleReveal() {
		if (revealed) {
			revealed = false;
			return;
		}
		if (secret && !value) {
			loading = true;
			revealError = '';
			try {
				const response = await fetch(
					resolve('/configuration/secrets/[id]/value', { id: secret.id })
				);
				if (!response.ok) throw new Error();
				value = (await response.json()).value;
			} catch {
				revealError = 'Could not reveal this secret. Check your connection and access.';
				return;
			} finally {
				loading = false;
			}
		}
		revealed = true;
	}
</script>

<Card.Root class="panel" aria-label={secret?.name ?? 'Add a secret'}>
	<Card.Header class="p-0">
		<Card.Title>{secret?.name ?? 'Add a secret'}</Card.Title>
		<Card.Description
			>{secret
				? 'Edit the name, notes or value.'
				: 'Save a value once and use it across repositories.'}</Card.Description
		>
	</Card.Header>
	<Card.Content class="p-0">
		{#if secret?.aliases?.length}
			<p class="mb-4 text-sm text-muted-foreground">
				Also Known As: {secret.aliases.map((alias) => alias.name).join(', ')}
			</p>
		{/if}
		<form
			method="POST"
			action="?/saveSecret"
			class="space-y-4"
			use:enhance={() =>
				async ({ result, update }) => {
					if (result.type === 'success') {
						value = '';
						revealed = false;
					}
					await update();
				}}
		>
			<input type="hidden" name="id" value={secret?.id ?? ''} />
			<div class="space-y-2">
				<label for={`${fieldId}-name`}>Secret name</label>
				<Input
					id={`${fieldId}-name`}
					name="name"
					value={secret?.name ?? ''}
					required
					autocomplete="off"
				/>
			</div>
			<div class="space-y-2">
				<label for={`${fieldId}-description`}>Notes</label>
				<Input id={`${fieldId}-description`} name="description" value={secret?.description ?? ''} />
			</div>
			<div class="space-y-2">
				<label for={`${fieldId}-value`}>Value</label>
				<div class="flex gap-2">
					<Input
						id={`${fieldId}-value`}
						name="value"
						type={revealed ? 'text' : 'password'}
						bind:value
						placeholder={secret ? '••••••••' : 'Enter secret value'}
						required={!secret}
						autocomplete="new-password"
						spellcheck="false"
						class="font-mono"
					/>
					<Button
						type="button"
						variant="outline"
						onclick={toggleReveal}
						disabled={loading}
						aria-pressed={revealed}>{loading ? 'Loading…' : revealed ? 'Hide' : 'Reveal'}</Button
					>
				</div>
				{#if secret}<p class="text-sm text-muted-foreground">
						Leave the value blank to keep the saved key.
					</p>{/if}
				{#if revealError}<p role="alert" class="text-sm text-destructive">{revealError}</p>{/if}
			</div>
			<Button type="submit">{secret ? 'Save secret' : 'Add secret'}</Button>
		</form>
		{#if secret}
			<form method="POST" action="?/deleteSecret" use:enhance class="mt-3">
				<input type="hidden" name="id" value={secret.id} />
				<Button type="submit" variant="outline">Delete secret</Button>
			</form>
		{/if}
	</Card.Content>
</Card.Root>
