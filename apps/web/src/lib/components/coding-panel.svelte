<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import { missingBrowserEvidence } from '@code-assist/intake/coding-types';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workflowBadgeVariant } from '#lib/workflow-status.js';
	import TicketSection from './ticket-section.svelte';
	import CodingChanges from './coding-changes.svelte';
	import CodingActions from './coding-actions.svelte';
	import CodingReply from './coding-reply.svelte';
	import Markdown from './markdown.svelte';
	let {
		run,
		editable,
		ownerCompleted = false,
		html
	}: {
		run: CodingDetail;
		editable: boolean;
		ownerCompleted?: boolean;
		html: Record<string, string>;
	} = $props();
	const titles = {
		prepare: 'Preparing Workspace',
		implement: 'Codex Implementing',
		checkpoint: 'Saving Code Checkpoint',
		collect: 'Collecting Saved Evidence',
		validate: 'Running Validation',
		review: 'Claude Reviewing',
		publish: 'Publishing Pull Request',
		failed: 'Needs Attention',
		needs_direction: 'Your Direction Needed',
		pr_open: 'Pull Request Open',
		pr_closed: 'Closed Without Merge',
		awaiting_main: 'Waiting for Main Workflow',
		main_running: 'Main Workflows Running',
		main_failed: 'Main Workflow Failed',
		done: 'Done',
		superseded: 'Superseded'
	};
	const workflowLabel = (value: string | null) =>
		(value ?? 'Unknown')
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	const latest = $derived(run.steps.find((s) => s.id === run.current_step_id));
	const deployments = $derived(
		run.steps.filter(
			(step) => step.kind === 'publish' && step.status === 'completed' && step.result?.deployment
		)
	);
	const needsBrowserChecks = $derived(
		run.status === 'failed' && missingBrowserEvidence(run, latest)
	);
	const directionQuestion = $derived(
		typeof latest?.result?.directionQuestion === 'string' ? latest.result.directionQuestion : ''
	);
	let changesOpen = $state(false);
	const retryLabel = $derived(
		needsBrowserChecks
			? 'Run Browser Checks'
			: latest?.kind === 'collect'
				? 'Retry Evidence Collection'
				: latest?.kind === 'checkpoint'
					? 'Retry Saving Checkpoint'
					: 'Retry Coding Step'
	);
	async function reveal(
		target: 'changes' | 'activity' | 'reply' | 'repositories',
		expand: () => void
	) {
		expand();
		if (target === 'changes') changesOpen = true;
		await tick();
		const id =
			target === 'changes'
				? 'changes-'
				: target === 'reply'
					? 'coding-reply-'
					: target === 'repositories'
						? 'coding-repositories-'
						: 'coding-activity-';
		const element = document.getElementById(id + run.id);
		if (target === 'activity' && element?.parentElement instanceof HTMLDetailsElement)
			element.parentElement.open = true;
		element?.focus();
	}
</script>

<TicketSection
	id={'coding-' + run.id}
	title={run.repair ? 'Main Workflow Repair' : 'Coding'}
	collapsed={run.status === 'done' || run.status === 'superseded' || !editable}
>
	{#snippet actions(expand: () => void)}
		<CodingActions
			{run}
			{editable}
			{ownerCompleted}
			statusLabel={editable ? titles[run.status] : 'View Previous Run'}
			{retryLabel}
			onreveal={(target) => reveal(target, expand)}
		/>
	{/snippet}
	{#if run.status === 'needs_direction'}
		<section
			aria-labelledby={'coding-question-' + run.id}
			class="space-y-2 rounded-md border border-yellow-300 bg-yellow-50 p-4"
		>
			<h3 id={'coding-question-' + run.id} class="text-base font-medium">Agent Question</h3>
			{#if directionQuestion}
				<Markdown html={html[`${run.current_step_id}:directionQuestion`] ?? ''} />
			{:else}
				<p>
					The agent stopped without a question. Review its latest result in Coding Activity below.
				</p>
			{/if}
			<p class="text-sm">Coding is paused. The saved code and evidence are preserved.</p>
			{#if editable}<CodingReply {run} />{/if}
		</section>
	{/if}
	<p class="text-sm text-muted-foreground">
		Plan v{run.version} · <span class="break-all">{run.branch}</span>{#if run.commit}
			· {run.commit.slice(0, 7)}{/if}
	</p>
	{#if deployments.length}
		{@const deployment = deployments.at(-1)!.result!.deployment as {
			url: string;
			jobUrl: string;
			branch: string;
		}}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Controller-verified Windmill fork URL. -->
			<a class="underline" href={deployment.url} target="_blank" rel="noreferrer"
				>Open Windmill Fork</a
			>
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Controller-verified native Git Sync job. -->
			<a class="underline" href={deployment.jobUrl} target="_blank" rel="noreferrer"
				>View Deployment</a
			>
			<span class="break-all text-muted-foreground">{deployment.branch}</span>
		</div>
	{/if}
	{#if run.repositories}
		<div class="space-y-2 text-sm">
			<h3 id={'coding-repositories-' + run.id} tabindex="-1" class="font-medium">
				Repository Progress
			</h3>
			<p class="text-muted-foreground">
				Repositories run one at a time. Claude reviews the combined implementation before PR
				publication. Done requires every repository’s main workflow to succeed.
			</p>
			{#each run.repositories as repository, index (repository.name)}
				<div class="space-y-2 rounded-md border p-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-medium">{index + 1}. {repository.name}</span>
						<Badge
							variant={workflowBadgeVariant(
								index === run.repository_index ? run.status : repository.status,
								editable
							)}
							>{index === run.repository_index &&
							[
								'prepare',
								'implement',
								'checkpoint',
								'collect',
								'validate',
								'review',
								'publish',
								'failed',
								'needs_direction'
							].includes(run.status)
								? titles[run.status]
								: titles[repository.status]}</Badge
						>
						{#if repository.commit}<span class="text-muted-foreground"
								>{repository.commit.slice(0, 7)}</span
							>{/if}
						{#if repository.pr_url}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Published GitHub URL. -->
							<a class="underline" href={repository.pr_url} target="_blank" rel="noreferrer"
								>{repository.merged_at ? 'View Merged PR' : 'Review PR'} →</a
							>
						{/if}
					</div>
					{#if repository.github_error}<p role="alert">{repository.github_error}</p>{/if}
					{#each repository.main_workflows?.runs ?? [] as workflow (workflow.id)}
						<div>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Validated GitHub workflow URL. -->
							<a class="underline" href={workflow.html_url} target="_blank" rel="noreferrer"
								>{workflow.name}</a
							>
							· {workflowLabel(
								workflow.status === 'completed' ? workflow.conclusion : workflow.status
							)} · Attempt {workflow.run_attempt}
						</div>
					{/each}
					{#if repository.main_workflows?.failureArtifact}<a
							class="underline"
							href={resolve('/api/artifacts/[id]', {
								id: repository.main_workflows.failureArtifact
							})}>Failure Evidence →</a
						>{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if run.workspace_cleaned_at}
		<p class="text-sm text-muted-foreground">
			Workspace cleaned up {new Date(run.workspace_cleaned_at).toLocaleString()}. Code checkpoints,
			evidence, logs, and ticket history are retained.
		</p>
	{:else if run.workspace_cleanup_error}
		<p role="alert" class="text-sm">Workspace Cleanup: {run.workspace_cleanup_error}</p>
	{:else if run.status === 'done' && run.workspace_id}
		<p class="text-sm text-muted-foreground">
			Workspace cleanup runs automatically after 24 hours in Done, once saved code and evidence are
			verified.
		</p>
	{/if}
	{#if needsBrowserChecks}
		<p role="alert">
			The code and evidence are saved, but this attempt did not run the required browser checks. Run
			Browser Checks to have Codex complete them from the saved checkpoint.
		</p>
	{:else if run.error}<p role="alert">{run.error}</p>{/if}
	{#if !needsBrowserChecks && latest?.kind === 'collect' && (run.status === 'collect' || run.status === 'failed')}<p
			class="text-sm text-muted-foreground"
		>
			The agent result and code checkpoint are saved. Evidence collection resumes from that
			checkpoint without running the agent again.
		</p>{/if}
	{#if run.pr_url}
		<p class="text-xs text-muted-foreground">
			{#if run.github_checked_at}GitHub checked {new Date(
					run.github_checked_at
				).toLocaleString()}.{:else}Waiting for the first GitHub check.{/if}
		</p>
		{#if run.github_error}<p role="alert">{run.github_error}</p>{/if}
		{#if run.merged_at && run.merge_commit}
			<p class="text-sm">
				Merged {new Date(run.merged_at).toLocaleString()} · Commit {run.merge_commit.slice(0, 7)}.
				{#if run.status === 'done'}All observed push-to-main workflows for this merge commit
					succeeded.{:else}Done waits for successful push-to-main workflows for this exact merge
					commit.{/if}
			</p>
		{:else if run.status === 'pr_closed'}
			<p class="text-sm">
				The pull request was closed without merging{run.pr_closed_at
					? ` on ${new Date(run.pr_closed_at).toLocaleString()}`
					: ''}. Review it in GitHub to decide what happens next.
			</p>
		{/if}
	{/if}
	{#if run.main_workflows}
		<div class="space-y-2 text-sm">
			<h3 class="font-medium">Main Workflows</h3>
			{#if !run.main_workflows.runs.length}<p>
					No matching push-to-main workflow has been reported yet.
				</p>{/if}
			{#each run.main_workflows.runs as workflow (workflow.id)}
				<div class="flex flex-wrap items-center gap-2">
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- Validated GitHub workflow URL. -->
					<a class="underline" href={workflow.html_url} target="_blank" rel="noreferrer"
						>{workflow.name}</a
					>
					<Badge
						variant={workflow.status !== 'completed' || workflow.conclusion === 'success'
							? 'active'
							: 'attention'}
						>{workflowLabel(
							workflow.status === 'completed' ? workflow.conclusion : workflow.status
						)}</Badge
					>
					<span class="text-muted-foreground">Attempt {workflow.run_attempt}</span>
				</div>
			{/each}
			{#if run.main_workflows.failureArtifact}
				<a
					class="underline"
					href={resolve('/api/artifacts/[id]', { id: run.main_workflows.failureArtifact })}
					>Failure Evidence →</a
				>
			{/if}
		</div>
	{/if}
	{#if run.repair}<p class="text-sm text-muted-foreground">
			Corrective run from merged commit {run.repair.baseCommit.slice(0, 7)}. The original PR and
			workflow evidence are preserved. Any code fix goes through validation, Claude review, and a
			new PR.
		</p>{/if}

	{#if run.status === 'failed' && editable && latest && !run.pr_url}
		<details>
			<summary class="cursor-pointer text-sm">Choose a Different Branch</summary>
			<form method="POST" use:enhance class="mt-3 space-y-3">
				<input type="hidden" name="intent" value="coding-branch" /><input
					type="hidden"
					name="codingId"
					value={run.id}
				/><input type="hidden" name="stepId" value={latest.id} /><label
					for={`branch-${run.id}`}
					class="text-sm font-medium">New Branch Name</label
				><Input
					id={`branch-${run.id}`}
					name="branch"
					required
					placeholder={`feature/${run.identifier.toLowerCase()}-code-assist`}
				/>
				<p class="text-sm text-muted-foreground">
					Authorize this run to use the new branch and retry from its saved checkpoint. Existing
					branches are preserved.
				</p>
				<Button type="submit" variant="outline">Use Branch and Retry</Button>
			</form>
		</details>
	{/if}
	{#if changesOpen && editable && run.status === 'pr_open'}
		<CodingChanges
			{run}
			onclose={async () => {
				changesOpen = false;
				await tick();
				document.getElementById('coding-actions-' + run.id)?.focus();
			}}
		/>
	{/if}
	<div class="space-y-4">
		<details
			open={latest?.status === 'running' || latest?.status === 'queued' || run.status === 'failed'}
		>
			<summary id={'coding-activity-' + run.id} class="cursor-pointer text-sm font-medium"
				>Coding Activity ({run.steps.length} {run.steps.length === 1 ? 'Step' : 'Steps'})</summary
			>
			<div class="mt-3 space-y-3">
				{#each run.steps as step (step.id)}
					<details
						open={step.id === run.current_step_id && step.status !== 'completed'}
						class="rounded-md border p-3"
					>
						<summary class="cursor-pointer text-sm font-medium"
							>{titles[step.kind]}{run.repositories
								? ` · ${run.repositories[step.repository_index ?? 0].name}`
								: ''} · {workflowLabel(step.status)} · {new Date(
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
								{#if typeof step.result.summary === 'string'}
									<Markdown html={html[`${step.id}:summary`] ?? ''} />
								{/if}
								{#if typeof step.result.directionQuestion === 'string' && step.result.directionQuestion}
									<Markdown html={html[`${step.id}:directionQuestion`] ?? ''} />
								{/if}
								{#if step.result.commands && typeof step.result.commands === 'object'}<ul>
										{#each Object.entries(step.result.commands) as [command, code] (command)}<li>
												{command}: {code === 0 ? 'Passed' : 'Failed'}
											</li>{/each}
									</ul>{/if}
								{#if Array.isArray(step.result.findings)}{#each step.result.findings as finding, index (finding.id)}<div
											class="rounded-md border p-3"
										>
											<p class="font-medium">{finding.severity} · {finding.title}</p>
											<Markdown html={html[`${step.id}:finding:${index}:detail`] ?? ''} />
											<Markdown html={html[`${step.id}:finding:${index}:recommendation`] ?? ''} />
										</div>{/each}{/if}
							{/if}
						</div>
					</details>
				{/each}
			</div>
		</details>
		{#if run.direction_responses?.length}
			<details>
				<summary class="cursor-pointer text-sm font-medium"
					>Previous Replies ({run.direction_responses.length})</summary
				>
				<div class="mt-3 space-y-4">
					{#each run.direction_responses as reply (reply.id)}
						<div class="space-y-2 text-sm">
							<p>{new Date(reply.createdAt).toLocaleString()}</p>
							{#if reply.question}<p class="break-words whitespace-pre-wrap">
									{reply.question}
								</p>{/if}
							<p class="break-words whitespace-pre-wrap text-foreground!">{reply.text}</p>
						</div>
					{/each}
				</div>
			</details>
		{/if}
		{#if run.change_requests?.length}
			<details>
				<summary class="cursor-pointer text-sm font-medium"
					>Previous Code Requests ({run.change_requests.length})</summary
				>
				<div class="mt-3 space-y-4">
					{#each run.change_requests as request, index (request.id)}
						<div>
							<p class="text-sm text-muted-foreground">
								Revision {index + 1} · {new Date(request.createdAt).toLocaleString()}
							</p>
							<p class="text-sm whitespace-pre-wrap">{request.text}</p>
						</div>
					{/each}
				</div>
			</details>
		{/if}
	</div>
</TicketSection>
