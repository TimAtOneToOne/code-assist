<script lang="ts">
	import { resolve } from '$app/paths';
	import type { CodingRun } from '@code-assist/intake/coding';
	import { Badge } from '#lib/components/ui/badge/index.js';
	let {
		checks,
		currentCommit
	}: { checks: NonNullable<CodingRun['pr_checks']>; currentCommit: string | null } = $props();
</script>

<div class="space-y-2 text-sm">
	<h3 class="font-medium">PR Checks</h3>
	<p class="text-muted-foreground">
		Commit {checks.commit.slice(0, 7)}{checks.commit !== currentCommit
			? ' · Previous Candidate'
			: ''}
	</p>
	{#if !checks.checks.length}<p>No checks have been reported for this commit.</p>{/if}
	{#each checks.checks as check (`${check.kind}:${check.id}`)}
		<div class="flex flex-wrap items-center gap-2">
			{#if check.url}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Validated HTTP(S) check provider URL. -->
				<a class="underline" href={check.url} target="_blank" rel="noreferrer">{check.name}</a>
			{:else}<span>{check.name}</span>{/if}
			<Badge
				variant={['failure', 'error', 'timed_out', 'action_required', 'startup_failure'].includes(
					check.conclusion ?? ''
				)
					? 'attention'
					: 'active'}
				>{(check.conclusion ?? check.status)
					.replaceAll('_', ' ')
					.replace(/\b\w/g, (letter) => letter.toUpperCase())}</Badge
			>
		</div>
	{/each}
	{#if checks.failureArtifact}<a
			class="underline"
			href={resolve('/api/artifacts/[id]', { id: checks.failureArtifact })}>PR Failure Evidence →</a
		>{/if}
	{#if checks.error}<p role="alert">{checks.error}</p>{/if}
</div>
