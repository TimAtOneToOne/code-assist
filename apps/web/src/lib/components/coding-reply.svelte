<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import type { CodingDetail } from '@code-assist/intake/coding';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	let { run }: { run: CodingDetail } = $props();
	let submitting = $state(false);
	const submit: SubmitFunction = () => {
		submitting = true;
		return async ({ result, update }) => {
			try {
				if (result.type === 'success') {
					toast.success('Reply saved. Coding will continue.');
					await update({ reset: true });
				} else
					toast.error(
						result.type === 'failure'
							? (result.data?.error ?? 'Could not save your reply.')
							: 'Could not save your reply.'
					);
			} finally {
				submitting = false;
			}
		};
	};
</script>

<form method="POST" use:enhance={submit} class="space-y-3 pt-2">
	<input type="hidden" name="intent" value="coding-direction" />
	<input type="hidden" name="codingId" value={run.id} />
	<input type="hidden" name="stepId" value={run.current_step_id} />
	<label for={'coding-reply-' + run.id} class="text-sm font-medium">Your Reply</label>
	<Textarea
		id={'coding-reply-' + run.id}
		name="reply"
		rows={4}
		required
		class="bg-background"
		placeholder="Answer the question, clarify what matters, or paste relevant examples…"
	/>
	<p class="text-sm">Codex will continue from the saved work, then run checks and Claude review.</p>
	<Button type="submit" disabled={submitting}
		>{submitting ? 'Saving…' : 'Reply and Continue'}</Button
	>
</form>
