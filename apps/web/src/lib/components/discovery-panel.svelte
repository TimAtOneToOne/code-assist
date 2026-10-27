<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workflowBadgeVariant } from '#lib/workflow-status.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import TicketSection from './ticket-section.svelte';
	import Markdown from '#lib/components/markdown.svelte';
	import type { DiscoveryRun } from '@code-assist/intake/discovery';
	let {
		run,
		summaryHtml,
		editable = true,
		title = 'Initial Discovery'
	}: { run: DiscoveryRun; summaryHtml: string; editable?: boolean; title?: string } = $props();
	let answers = $derived(
		run.answers ? [...run.answers] : (run.result?.questions.map(() => '') ?? [])
	);
	const badgeVariant = $derived(workflowBadgeVariant(run.status, editable));
</script>

<TicketSection
	{title}
	collapsed={run.status === 'ready' || run.status === 'superseded' || !editable}
>
	{#snippet actions()}
		<Badge variant={badgeVariant}
			>{run.status === 'ready'
				? 'Answers Saved'
				: badgeVariant === 'attention'
					? 'Needs Your Attention'
					: badgeVariant === 'active'
						? 'Working'
						: 'Previous Discovery'}</Badge
		>
		{#if editable && ['questions', 'failed'].includes(run.status)}
			<form method="POST" use:enhance>
				<input type="hidden" name="intent" value="retry" />
				<input type="hidden" name="runId" value={run.id} />
				<Button
					type="submit"
					variant="outline"
					size="sm"
					title="Run discovery again with the selected repositories. This result stays in history."
					>Rerun Step</Button
				>
			</form>
		{/if}
		<Button type="button" variant="outline" size="sm" onclick={() => invalidateAll()}
			>Refresh</Button
		>
	{/snippet}
	{#if ['queued', 'running'].includes(run.status)}
		<p>
			Codex will prepare any unconfigured repositories, then return findings and any questions
			needed before planning. You can close this page.
		</p>
	{:else if run.status === 'failed'}
		<p role="alert" class="text-destructive">{run.error}</p>
	{/if}
	{#if run.result}
		<section class="discovery-explanation space-y-3" aria-label="What I Understand">
			<h3 class="font-medium">What I Understand</h3>
			<Markdown html={summaryHtml} />
		</section>
		{#if run.setup_pending}
			<p class="text-sm text-muted-foreground">
				A setup issue needs your input before we can finish investigating this change.
			</p>
		{/if}
		{#if run.answers}
			{#each run.result.questions as question, index (index)}<div>
					<h3 class="font-medium">{question.question}</h3>
					<p class="whitespace-pre-wrap">{run.answers[index]}</p>
				</div>{/each}
			{#if run.notes}<div>
					<h3 class="font-medium">Additional Direction</h3>
					<p class="whitespace-pre-wrap">{run.notes}</p>
				</div>{/if}
			<p>
				{run.setup_pending
					? 'These answers guide repository setup.'
					: 'These answers form the saved planning baseline.'}
			</p>
		{:else if run.status === 'questions' && editable}
			<form method="POST" use:enhance class="space-y-6">
				{#if run.result.questions.length}
					<h3 class="font-medium">
						{run.setup_pending ? 'Needed to Continue Setup' : 'Questions Before Planning'}
					</h3>
				{/if}
				<input type="hidden" name="intent" value="answers" /><input
					type="hidden"
					name="runId"
					value={run.id}
				/>
				{#each run.result.questions as question, index (index)}<div class="space-y-2">
						<label class="block font-medium" for={`answer-${run.id}-${index}`}
							>{question.question}</label
						>
						<p class="text-sm">{question.context}</p>
						{#if question.options.length}<div class="flex flex-wrap gap-2">
								{#each question.options as option, optionIndex (optionIndex)}<Button
										type="button"
										size="sm"
										variant={answers[index] === option ? 'secondary' : 'outline'}
										class="h-auto text-left whitespace-normal"
										onclick={() =>
											(answers = answers.map((answer, answerIndex) =>
												answerIndex === index ? option : answer
											))}>{option}</Button
									>{/each}
							</div>{/if}
						<Textarea
							id={`answer-${run.id}-${index}`}
							name="answer"
							required
							bind:value={answers[index]}
							placeholder={question.options.length
								? 'Choose an option above or write your own answer.'
								: 'Your answer'}
						/>
					</div>{:else}<p>
						There are no open questions. Review the explanation and confirm the scope before
						planning.
					</p>{/each}
				<div class="space-y-2">
					<label for={`notes-${run.id}`} class="text-sm font-medium"
						>Additional Direction (optional)</label
					><Textarea
						id={`notes-${run.id}`}
						name="notes"
						placeholder="Anything else the planning cycle should know?"
					/>
				</div>
				{#if run.setup_pending}
					<input type="hidden" name="scope" value="confirmed" />
					<p class="text-sm text-muted-foreground">
						If access credentials are needed, add them in
						<a class="underline" href={resolve('/configuration/secrets')}>Secrets</a>
						and connect them to this repository. Do not paste passwords or tokens here.
					</p>
				{:else}<label class="flex items-start gap-2 text-sm"
						><input class="mt-1" type="checkbox" name="scope" value="confirmed" required /><span
							>I confirm the repository scope: {run.repositories
								.map((path) => path.split('/').at(-1))
								.join(', ')}.</span
						></label
					>{/if}
				<div class="flex flex-wrap items-center gap-3">
					<Button type="submit"
						>{run.setup_pending
							? 'Save Answers and Continue Setup'
							: 'Confirm Scope and Save Answers'}</Button
					><span class="text-sm text-muted-foreground"
						>{run.setup_pending
							? 'Setup must finish before ticket discovery and planning.'
							: 'No plan yet. Your answers become the planning baseline.'}</span
					>
				</div>
			</form>
		{:else}
			{#each run.result.questions as question, index (index)}<div>
					<h3 class="font-medium">{question.question}</h3>
					<p>{question.context}</p>
				</div>{/each}
		{/if}
		{#if run.result.findings.length}<details>
				<summary class="cursor-pointer text-sm font-medium"
					>Supporting Findings · {run.result.findings.length}</summary
				>
				<ul class="mt-3 space-y-3">
					{#each run.result.findings as finding, index (index)}<li class="text-sm">
							<div class="font-medium break-words">{finding.repository} · {finding.file}</div>
							<p>{finding.detail}</p>
						</li>{/each}
				</ul>
			</details>{/if}
	{/if}
	{#if run.setup_progress?.length}
		<details open={!run.result || run.status === 'failed'}>
			<summary class="cursor-pointer text-sm font-medium">Repository Setup Details</summary>
			<div class="mt-3 space-y-2">
				{#each run.setup_progress as setup (setup.repository)}
					<div class="text-sm">
						<a
							class="underline"
							href={resolve(
								`/configuration/repositories?repository=${encodeURIComponent(setup.repository)}`
							)}>{setup.name}</a
						>
						· {{
							scanning: 'Scanning Repository',
							testing: 'Testing Setup',
							questions: 'Needs Your Input',
							failed: 'Setup Test Failed',
							saved: 'Tested and Saved',
							reused: 'Using Existing Setup'
						}[setup.status]}
						{#if setup.summary && setup.summary !== run.result?.summary}<p
								class="whitespace-pre-wrap"
							>
								{setup.summary}
							</p>{/if}
						{#if setup.testId}<p class="text-muted-foreground">
								Setup test results and logs are available from the repository link above.
							</p>{/if}
					</div>
				{/each}
			</div>
		</details>
	{/if}
	<details>
		<summary class="cursor-pointer text-sm text-muted-foreground">Run Details</summary>
		<div class="mt-3 space-y-2 text-sm text-muted-foreground">
			<p>Started {new Date(run.created_at).toLocaleString()} · {run.status}</p>
			{#each run.snapshots ?? [] as snapshot (snapshot.source)}<p class="break-all">
					{snapshot.name} · {snapshot.commit}
				</p>{/each}
			<p class="break-all">Attempt: {run.id}</p>
			<a class="underline" href={resolve(`/logs?attempt=${run.id}`)}>View Codex activity</a>
		</div>
	</details>
</TicketSection>

<style>
	.discovery-explanation :global(pre) {
		white-space: pre-wrap;
	}
</style>
