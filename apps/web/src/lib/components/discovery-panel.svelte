<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { workflowBadgeVariant } from '#lib/workflow-status.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import Markdown from '#lib/components/markdown.svelte';
	import type { DiscoveryRun } from '@code-assist/intake/discovery';
	let {
		run,
		summaryHtml,
		editable = true
	}: { run: DiscoveryRun; summaryHtml: string; editable?: boolean } = $props();
	let answers = $derived(
		run.answers ? [...run.answers] : (run.result?.questions.map(() => '') ?? [])
	);
	const badgeVariant = $derived(workflowBadgeVariant(run.status, editable));
</script>

<Card.Root class="panel">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<div class="mb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
				Codex · Initial Discovery
			</div>
			<Card.Title
				>{run.status === 'queued'
					? 'Waiting for Codex'
					: run.status === 'running'
						? 'Reading the Ticket and Repositories'
						: run.status === 'failed'
							? 'Discovery Needs Attention'
							: run.answers
								? 'Scope and Answers Saved'
								: 'Confirm Scope and Answer Open Questions'}</Card.Title
			>
		</div>
		<Badge variant={badgeVariant}
			>{badgeVariant === 'attention'
				? 'Needs Your Attention'
				: badgeVariant === 'active'
					? 'Working'
					: run.status === 'ready'
						? 'Answers Saved'
						: 'Previous Discovery'}</Badge
		>
		{#if ['queued', 'running'].includes(run.status)}<Button
				type="button"
				variant="outline"
				size="sm"
				onclick={() => invalidateAll()}>Refresh activity</Button
			>{/if}
	</div>
	{#if ['queued', 'running'].includes(run.status)}
		<p>
			Codex will inspect the selected repositories and return findings and any questions needed
			before planning. You can close this page.
		</p>
	{:else if run.status === 'failed'}
		<p role="alert" class="text-destructive">{run.error}</p>
		{#if editable}<form method="POST" use:enhance>
				<input type="hidden" name="intent" value="retry" /><input
					type="hidden"
					name="runId"
					value={run.id}
				/>
				<Button type="submit">Retry discovery</Button>
			</form>{/if}
	{/if}
	{#if run.result}
		<Markdown html={summaryHtml} />
		{#if run.result.findings.length}<details>
				<summary class="cursor-pointer text-sm font-medium"
					>Supporting findings · {run.result.findings.length}</summary
				>
				<ul class="mt-3 space-y-3">
					{#each run.result.findings as finding, index (index)}<li class="text-sm">
							<div class="font-medium break-words">{finding.repository} · {finding.file}</div>
							<p>{finding.detail}</p>
						</li>{/each}
				</ul>
			</details>{/if}
		{#if run.answers}
			{#each run.result.questions as question, index (index)}<div>
					<h3 class="font-medium">{question.question}</h3>
					<p class="whitespace-pre-wrap">{run.answers[index]}</p>
				</div>{/each}
			{#if run.notes}<div>
					<h3 class="font-medium">Additional Direction</h3>
					<p class="whitespace-pre-wrap">{run.notes}</p>
				</div>{/if}
			<p>These answers are saved as the planning baseline. Full planning has not started.</p>
		{:else if run.status === 'questions' && editable}
			<form method="POST" use:enhance class="space-y-6">
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
							placeholder="Your answer — choose an option above or write your own."
						/>
					</div>{:else}<p>
						Codex found no open questions. Review the findings and confirm the scope before
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
				<label class="flex items-start gap-2 text-sm"
					><input class="mt-1" type="checkbox" name="scope" value="confirmed" required /><span
						>I confirm the repository scope: {run.repositories
							.map((path) => path.split('/').at(-1))
							.join(', ')}.</span
					></label
				>
				<div class="flex flex-wrap items-center gap-3">
					<Button type="submit">Confirm scope & save answers</Button><span
						class="text-sm text-muted-foreground"
						>No plan yet. Your answers become the planning baseline.</span
					>
				</div>
			</form>
		{:else}
			{#each run.result.questions as question, index (index)}<div>
					<h3 class="font-medium">{question.question}</h3>
					<p>{question.context}</p>
				</div>{/each}
		{/if}
	{/if}
	<details>
		<summary class="cursor-pointer text-sm text-muted-foreground">Run details</summary>
		<div class="mt-3 space-y-2 text-sm text-muted-foreground">
			<p>Started {new Date(run.created_at).toLocaleString()} · {run.status}</p>
			{#each run.snapshots ?? [] as snapshot (snapshot.source)}<p class="break-all">
					{snapshot.name} · {snapshot.commit}
				</p>{/each}
			<p class="break-all">Attempt: {run.id}</p>
			<a class="underline" href={resolve(`/logs?attempt=${run.id}`)}>View Codex activity</a>
		</div>
	</details>
</Card.Root>
