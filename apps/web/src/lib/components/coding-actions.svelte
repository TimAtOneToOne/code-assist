<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { toast } from 'svelte-sonner';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';

	let {
		run,
		editable,
		statusLabel,
		retryLabel,
		onreveal
	}: {
		run: CodingDetail;
		editable: boolean;
		statusLabel: string;
		retryLabel: string;
		onreveal: (target: 'changes' | 'activity' | 'reply' | 'repositories') => void | Promise<void>;
	} = $props();
	let githubForm = $state<HTMLFormElement>();
	let mainForm = $state<HTMLFormElement>();
	let submitting = $state(false);
	let revealAfterClose: 'changes' | undefined;
	const canRetry = $derived(editable && run.status === 'failed' && !!run.current_step_id);
	const canReply = $derived(editable && run.status === 'needs_direction');
	const canBringMain = $derived(
		editable &&
			!!run.pr_url &&
			(run.status === 'pr_open' ||
				(run.status === 'needs_direction' && !!run.change_requests?.length))
	);
	const reviewState = $derived(
		['pr_open', 'pr_closed', 'done'].includes(run.status) && !!run.pr_url
	);
	const checkState = $derived(
		['awaiting_main', 'main_running', 'main_failed'].includes(run.status) && !!run.pr_url
	);
	const reviewLabel = $derived(
		run.merged_at
			? 'View Merged Pull Request'
			: run.status === 'pr_closed'
				? 'View Closed Pull Request'
				: 'Review Pull Request'
	);
	const submitMain: SubmitFunction = () => {
		submitting = true;
		return async ({ result, update }) => {
			try {
				if (result.type === 'success')
					toast.success(result.data?.message ?? 'Code changes queued.');
				else
					toast.error(
						result.type === 'failure'
							? (result.data?.error ?? 'Could not request changes.')
							: 'Could not request changes.'
					);
				await update({ reset: result.type === 'success' });
			} finally {
				submitting = false;
			}
		};
	};
</script>

<div class="inline-flex items-stretch" role="group" aria-label="Coding Actions">
	{#if canRetry}
		<Button class="rounded-r-none" type="submit" form={'coding-retry-' + run.id}
			>{retryLabel}</Button
		>
	{:else if canReply}
		<Button class="rounded-r-none" onclick={() => onreveal('reply')}>Reply to Agent</Button>
	{:else if reviewState && !run.repositories}
		<Button class="rounded-r-none" href={run.pr_url ?? undefined} target="_blank" rel="noreferrer"
			>{reviewLabel}</Button
		>
	{:else if reviewState}
		<Button class="rounded-r-none" onclick={() => onreveal('repositories')}
			>View Pull Requests</Button
		>
	{:else if checkState}
		<Button class="rounded-r-none" onclick={() => githubForm!.requestSubmit()}>Check GitHub</Button>
	{:else}
		<Button class="rounded-r-none" onclick={() => onreveal('activity')}>{statusLabel}</Button>
	{/if}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			id={'coding-actions-' + run.id}
			aria-label="More Coding Actions"
			class={buttonVariants({
				class: 'w-10 rounded-l-none border-l border-primary-foreground/25 px-3'
			})}
		>
			<ChevronDown class="size-4" aria-hidden="true" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content
			align="end"
			class="w-56"
			onCloseAutoFocus={(event) => {
				if (revealAfterClose) {
					event.preventDefault();
					void onreveal(revealAfterClose);
					revealAfterClose = undefined;
				}
			}}
		>
			{#if editable && run.status === 'pr_open'}
				<DropdownMenu.Item
					onSelect={() => {
						revealAfterClose = 'changes';
					}}>Request Code Changes</DropdownMenu.Item
				>
			{/if}
			{#if canBringMain}
				<DropdownMenu.Item disabled={submitting} onSelect={() => mainForm!.requestSubmit()}
					>Bring In Main</DropdownMenu.Item
				>
			{/if}
			{#if run.pr_url && !reviewState && !run.repositories}
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Published GitHub URL. -->
						<a {...props} href={run.pr_url} target="_blank" rel="noreferrer">{reviewLabel}</a>
					{/snippet}
				</DropdownMenu.Item>
			{/if}
			{#if run.pr_url && !checkState}
				<DropdownMenu.Item onSelect={() => githubForm!.requestSubmit()}
					>Check GitHub</DropdownMenu.Item
				>
			{/if}
			{#if run.pr_url}<DropdownMenu.Separator />{/if}
			<DropdownMenu.Item onSelect={() => invalidateAll()}>Refresh View</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
{#if run.pr_url}
	<form bind:this={githubForm} method="POST" use:enhance hidden>
		<input type="hidden" name="intent" value="github-refresh" />
		<input type="hidden" name="codingId" value={run.id} />
	</form>
{/if}
{#if canBringMain}
	<form bind:this={mainForm} method="POST" use:enhance={submitMain} hidden>
		<input type="hidden" name="intent" value="coding-main" />
		<input type="hidden" name="codingId" value={run.id} />
		<input type="hidden" name="stepId" value={run.current_step_id} />
	</form>
{/if}
{#if canRetry}
	<form id={'coding-retry-' + run.id} method="POST" use:enhance hidden>
		<input type="hidden" name="intent" value="coding-retry" />
		<input type="hidden" name="codingId" value={run.id} />
		<input type="hidden" name="stepId" value={run.current_step_id} />
	</form>
{/if}
