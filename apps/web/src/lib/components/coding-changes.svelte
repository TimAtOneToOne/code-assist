<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	let { run, onclose }: { run: CodingDetail; onclose: () => void } = $props();
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
				if (result.type === 'success') onclose();
			} finally {
				submitting = false;
			}
		};
	};
</script>

<section
	id={'code-changes-' + run.id}
	aria-labelledby={'code-changes-title-' + run.id}
	class="space-y-4"
>
	<h3 id={'code-changes-title-' + run.id} class="text-base font-medium">Request Changes</h3>
	<form method="POST" use:enhance={submit} class="space-y-3">
		<input type="hidden" name="intent" value="coding-changes" />
		<input type="hidden" name="codingId" value={run.id} />
		<input type="hidden" name="stepId" value={run.current_step_id} />
		<label for={`changes-${run.id}`} class="text-sm font-medium">What Should Change?</label>
		<Textarea
			id={`changes-${run.id}`}
			name="changes"
			aria-describedby={'changes-help-' + run.id}
			rows={4}
			required
			placeholder="Describe the changes you want in the implementation…"
		/>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<p id={'changes-help-' + run.id} class="max-w-lg text-xs text-muted-foreground">
				Codex will make the changes, rerun checks, and get Claude’s review before updating the PR.
			</p>
			<div class="flex items-center gap-2">
				<Button variant="ghost" onclick={onclose} disabled={submitting}>Cancel</Button>
				<Button type="submit" disabled={submitting}
					>{submitting ? 'Queuing…' : 'Request Code Changes'}</Button
				>
			</div>
		</div>
	</form>
</section>
