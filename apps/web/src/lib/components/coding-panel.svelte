<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	let { run, editable }: { run: CodingDetail; editable: boolean } = $props();
	const titles = {
		prepare: 'Preparing Workspace',
		implement: 'Codex Implementing',
		validate: 'Running Validation',
		review: 'Claude Reviewing',
		publish: 'Publishing Pull Request',
		failed: 'Needs Attention',
		needs_direction: 'Your Direction Needed',
		pr_open: 'Pull Request Open',
		superseded: 'Superseded'
	};
	const latest = $derived(run.steps.find((s) => s.id === run.current_step_id));
</script>

<Card.Root class="panel">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Card.Title>Coding</Card.Title>
		<div class="flex items-center gap-2">
			<Badge variant="secondary">{editable ? titles[run.status] : 'Previous Approved Scope'}</Badge
			><Button variant="outline" size="sm" onclick={() => invalidateAll()}>Refresh</Button>
		</div>
	</div>
	<p class="text-sm text-muted-foreground">
		Plan v{run.version} · {run.branch}{#if run.commit}
			· {run.commit.slice(0, 7)}{/if}
	</p>
	{#if run.error}<p role="alert">{run.error}</p>{/if}
	{#if run.pr_url}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- GitHub URL from the publication controller. -->
		<a class="font-medium underline" href={run.pr_url} target="_blank" rel="noreferrer"
			>Review Pull Request →</a
		>{/if}
	{#if run.status === 'needs_direction'}<p>
			The agent needs your direction. Read its question below, then use Requested Changes on the
			approved plan to revise the scope.
		</p>{/if}
	{#if run.status === 'failed' && editable && latest}<form method="POST" use:enhance>
			<input type="hidden" name="intent" value="coding-retry" /><input
				type="hidden"
				name="codingId"
				value={run.id}
			/><input type="hidden" name="stepId" value={latest.id} /><Button>Retry Coding Step</Button>
		</form>{/if}
	<div class="space-y-3">
		{#each run.steps as step (step.id)}
			<details open={step.id === run.current_step_id} class="rounded-md border p-3">
				<summary class="cursor-pointer text-sm font-medium"
					>{titles[step.kind]} · {step.status} · {new Date(
						step.created_at
					).toLocaleString()}</summary
				>
				<div class="mt-3 space-y-3 text-sm">
					<a class="underline" href={resolve(`/logs?attempt=${step.id}`)}
						>Agent Activity and Logs →</a
					>
					{#if step.input_commit}<p class="text-muted-foreground">
							Input Commit: {step.input_commit.slice(0, 7)}
						</p>{/if}
					{#if step.error}<p>{step.error}</p>{/if}
					{#if step.result}
						{#if typeof step.result.summary === 'string'}<p class="whitespace-pre-wrap">
								{step.result.summary}
							</p>{/if}
						{#if typeof step.result.directionQuestion === 'string' && step.result.directionQuestion}<p
								class="font-medium"
							>
								{step.result.directionQuestion}
							</p>{/if}
						{#if step.result.commands && typeof step.result.commands === 'object'}<ul>
								{#each Object.entries(step.result.commands) as [command, code] (command)}<li>
										{command}: {code === 0 ? 'Passed' : 'Failed'}
									</li>{/each}
							</ul>{/if}
						{#if Array.isArray(step.result.findings)}{#each step.result.findings as finding (finding.id)}<div
									class="rounded-md border p-3"
								>
									<p class="font-medium">{finding.severity} · {finding.title}</p>
									<p>{finding.detail}</p>
									<p>{finding.recommendation}</p>
								</div>{/each}{/if}
					{/if}
				</div>
			</details>
		{/each}
	</div>
</Card.Root>
