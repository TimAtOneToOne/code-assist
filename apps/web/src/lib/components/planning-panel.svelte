<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { PlanChanges } from '#lib/server/plan-changes.js';
	import type { PlanningDetail } from '@code-assist/intake/planning';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import Markdown from './markdown.svelte';
	let {
		run,
		html,
		changes,
		editable
	}: {
		run: PlanningDetail;
		html: Record<string, string>;
		changes: Record<string, PlanChanges & { previousVersion: number }>;
		editable: boolean;
	} = $props();
	let showChanges = $state(true);
	let selected = $state<number | null>(null);
	let version = $derived(run.versions.find((v) => v.number === (selected ?? run.current_version)));
	let comparison = $derived(version ? changes[`${run.id}:${version.number}`] : undefined);
	let current = $derived(version?.number === run.current_version);
	let review = $derived(version?.review);
	let approval = $derived(run.approvals.find((a) => a.version === version?.number));
	const label = {
		drafting: 'Codex is drafting',
		reviewing: 'Claude is reviewing',
		revising: 'Codex is revising',
		awaiting_approval: 'Ready for your approval',
		needs_direction: 'Your direction is needed',
		approved: 'Plan approved',
		failed: 'Planning needs attention',
		superseded: 'Earlier planning run'
	};
</script>

<Card.Root class="panel">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<Card.Title>Adversarial planning</Card.Title>
		<div class="flex items-center gap-2">
			<Badge variant="secondary">{label[run.status]}</Badge><Button
				variant="outline"
				size="sm"
				onclick={() => invalidateAll()}>Refresh</Button
			>
		</div>
	</div>
	{#if run.status === 'drafting'}<p>
			Codex is reading the confirmed answers and repository snapshots to draft plan v1.
		</p>{/if}
	{#if run.status === 'revising'}<p>
			Codex is preparing v{run.current_version + 1} from the review and your feedback.
		</p>{/if}
	{#if run.status === 'reviewing'}<p>
			Claude is independently checking plan v{run.current_version} against the repositories.
		</p>{/if}
	{#if run.error}<p role="alert" class="text-destructive">{run.error}</p>{/if}
	{#if run.status === 'failed' && editable}<form method="POST" use:enhance>
			<input type="hidden" name="intent" value="plan-retry" /><input
				type="hidden"
				name="planningId"
				value={run.id}
			/><input type="hidden" name="stepId" value={run.current_step_id} />
			<Button type="submit">Retry failed step</Button>
		</form>{/if}
	{#if run.versions.length}<div class="flex flex-wrap items-center gap-3">
			<label class="text-sm font-medium"
				>Version <select
					aria-label="Plan version"
					class="ml-2 rounded border bg-background px-2 py-1"
					value={selected ?? run.current_version}
					onchange={(event) => (selected = Number(event.currentTarget.value))}
					>{#each run.versions as v (v.number)}<option value={v.number}
							>v{v.number}{v.number === run.current_version ? ' · current' : ''}</option
						>{/each}</select
				></label
			>
			{#if version}<Button
					size="sm"
					variant="outline"
					href={resolve('/tickets/[id]/plans/[run]/[version]', {
						id: run.issue_id,
						run: run.id,
						version: String(version.number)
					})}>Download plan_v{version.number}.md</Button
				>{/if}
			{#if comparison}<label class="flex items-center gap-2 text-sm"
					><input type="checkbox" bind:checked={showChanges} />Show changes since v{comparison.previousVersion}</label
				>{/if}
		</div>{/if}
	{#if version}
		{#key `${run.id}:${version.number}`}
			<p class="text-sm text-muted-foreground">{version.document.changeSummary}</p>
			{#if showChanges && comparison}<p class="text-sm text-muted-foreground" role="status">
					{#if comparison.addedCount || comparison.removedCount}Yellow marks added or changed
						sections since v{comparison.previousVersion}. {comparison.addedCount} added or changed · {comparison.removedCount}
						removed or replaced.{:else}No content changes since v{comparison.previousVersion}.{/if}
				</p>{/if}
			<Markdown
				html={showChanges && comparison
					? comparison.html
					: (html[`${run.id}:${version.number}`] ?? '')}
			/>
			{#if showChanges && comparison?.removedHtml.length}<details class="rounded-lg border p-3">
					<summary class="cursor-pointer text-sm font-medium"
						>Removed text from v{comparison.previousVersion} · {comparison.removedCount} sections</summary
					>
					<p class="mt-3 text-sm text-muted-foreground">
						Previous wording that was removed or replaced in this version.
					</p>
					<div class="mt-3 divide-y">
						{#each comparison.removedHtml as removed, index (index)}<div class="py-3">
								<Markdown html={removed} />
							</div>{/each}
					</div>
				</details>{/if}
			{#if version.document.responses.length}<details>
					<summary class="cursor-pointer text-sm font-medium"
						>Codex responses to review findings</summary
					>
					<div class="mt-3 space-y-3">
						{#each version.document.responses as response, index (index)}<div class="text-sm">
								<strong>{response.findingId}</strong><Markdown
									html={html[`${run.id}:${version.number}:response:${index}`] ?? ''}
								/>
							</div>{/each}
					</div>
				</details>{/if}
			{#if review}
				<div class="border-t pt-4">
					<h3 class="font-semibold">Claude’s review · v{version.number}</h3>
					<Markdown html={html[`${run.id}:${version.number}:summary`] ?? ''} />
				</div>
				{#each review.findings as finding, index (finding.id)}<div
						class="space-y-2 rounded-lg border p-3"
					>
						<div class="flex flex-wrap items-center gap-2">
							<Badge
								variant={['critical', 'high'].includes(finding.severity)
									? 'destructive'
									: 'secondary'}>{finding.severity}</Badge
							><strong class="text-sm">{finding.title}</strong><span
								class="text-xs text-muted-foreground">{finding.id}</span
							>
						</div>
						<Markdown html={html[`${run.id}:${version.number}:finding:${index}:detail`] ?? ''} />
						<div>
							<strong class="text-sm">Recommendation:</strong><Markdown
								html={html[`${run.id}:${version.number}:finding:${index}:recommendation`] ?? ''}
							/>
						</div>
					</div>{/each}
				{#if !review.findings.length}<p class="text-sm">No unresolved findings.</p>{/if}
				{#if review.directionQuestion}<div class="rounded-lg border p-3">
						<strong>Decision needed:</strong><Markdown
							html={html[`${run.id}:${version.number}:direction`] ?? ''}
						/>
					</div>{/if}
				{#if current && editable && run.status === 'awaiting_approval'}
					<form method="POST" use:enhance class="space-y-4 border-t pt-4">
						<input type="hidden" name="intent" value="plan-approve" /><input
							type="hidden"
							name="planningId"
							value={run.id}
						/><input type="hidden" name="version" value={version.number} /><input
							type="hidden"
							name="hash"
							value={version.hash}
						/>
						{#each review.findings.filter((f) => f.severity === 'medium') as finding (finding.id)}<label
								class="flex items-start gap-2 text-sm"
								><input
									class="mt-1"
									type="checkbox"
									name="acceptedMedium"
									value={finding.id}
									required
								/><span
									>I accept the remaining medium concern: <strong>{finding.title}</strong>
									({finding.id}) for v{version.number}.</span
								></label
							>{/each}
						<label class="flex items-start gap-2 text-sm"
							><input
								class="mt-1"
								type="checkbox"
								name="authorization"
								value="confirmed"
								required
							/><span
								>I approve v{version.number} for the confirmed repositories and authorize implementation,
								branch creation, and PR publication. I will review and merge PRs. Separate GitOps approval
								requirements still apply.</span
							></label
						>
						<Button type="submit">Approve plan v{version.number}</Button>
						<p class="text-xs text-muted-foreground">
							Implementation is the next phase and is not running yet.
						</p>
					</form>
				{/if}
				{#if current && editable && ['awaiting_approval', 'needs_direction', 'approved'].includes(run.status)}<form
						method="POST"
						use:enhance
						class="space-y-3 border-t pt-4"
					>
						<input type="hidden" name="intent" value="plan-feedback" /><input
							type="hidden"
							name="planningId"
							value={run.id}
						/><input type="hidden" name="version" value={version.number} /><input
							type="hidden"
							name="hash"
							value={version.hash}
						/>
						<label class="block text-sm font-medium" for={`feedback-${run.id}`}
							>{run.status === 'needs_direction' ? 'Your direction' : 'Request changes'}</label
						><textarea
							id={`feedback-${run.id}`}
							class="w-full rounded-md border bg-background p-3"
							name="feedback"
							rows="3"
							required
							placeholder="What should change?"></textarea>
						<Button type="submit" variant="outline">Create revised plan</Button>
						<p class="text-xs text-muted-foreground">
							Creates v{version.number + 1} and another Claude review. Any current approval will no longer
							apply.
						</p>
					</form>{/if}
			{/if}
			{#if approval}<p class="text-sm">
					Approved v{approval.version} by {approval.approver} · {new Date(
						approval.created_at
					).toLocaleString()}{#if !current || run.status !== 'approved'}
						· historical approval{/if}. Accepted medium concerns: {approval.accepted_medium_ids.join(
						', '
					) || 'none'}.
				</p>{/if}
			<details>
				<summary class="cursor-pointer text-xs text-muted-foreground">Plan identity</summary>
				<p class="mt-2 text-xs break-all">
					Plan SHA-256: {version.hash}<br />Confirmed input SHA-256: {run.input_hash}
				</p>
			</details>
		{/key}
	{/if}
	{#if run.status === 'approved'}<p>Plan approved. Implementation has not started.</p>{/if}
	{#if run.feedback.length}<details>
			<summary class="cursor-pointer text-sm font-medium">Your feedback history</summary
			>{#each run.feedback as feedback, index (index)}<p class="mt-3 text-sm whitespace-pre-wrap">
					<strong>v{feedback.version}</strong> · {feedback.note}
				</p>{/each}
		</details>{/if}
	<details>
		<summary class="cursor-pointer text-sm text-muted-foreground">Agent activity</summary
		>{#each run.steps as step (step.id)}<div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
				<span>v{step.version} · {step.kind === 'draft' ? 'Codex' : 'Claude'} · {step.status}</span>
				<a class="underline" href={resolve(`/logs?attempt=${step.id}`)}>Logs</a
				>{#if step.session_id}<span class="text-xs break-all text-muted-foreground"
						>{step.session_id}</span
					>{/if}
			</div>{/each}
	</details>
</Card.Root>
