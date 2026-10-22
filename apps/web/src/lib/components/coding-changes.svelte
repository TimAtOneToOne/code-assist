<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	let { run, editable }: { run: CodingDetail; editable: boolean } = $props();
	let submitting = $state(false);
	const submit: SubmitFunction = () => {
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

{#if (editable && run.status === 'pr_open') || run.change_requests?.length}
	<Card.Root class="panel">
		<Card.Title>Requested Code Changes</Card.Title>
		{#if editable && run.status === 'pr_open'}
			<form method="POST" use:enhance={submit} class="space-y-3">
				<input type="hidden" name="intent" value="coding-changes" />
				<input type="hidden" name="codingId" value={run.id} />
				<input type="hidden" name="stepId" value={run.current_step_id} />
				<label for={`changes-${run.id}`} class="text-sm font-medium">What Should Change?</label>
				<Textarea
					id={`changes-${run.id}`}
					name="changes"
					rows={4}
					required
					placeholder="Describe the changes you want in the implementation…"
				/>
				<p class="text-sm text-muted-foreground">
					Codex will revise {run.branch}, rerun checks, and get Claude’s review before updating the
					existing PR.
				</p>
				<Button type="submit" disabled={submitting}
					>{submitting ? 'Queuing…' : 'Request Code Changes'}</Button
				>
			</form>
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
	</Card.Root>
{/if}
