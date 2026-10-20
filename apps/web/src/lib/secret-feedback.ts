import type { ActionResult, SubmitFunction } from '$app/forms';
import { toast } from 'svelte-sonner';

export function notifySecretAction(result: ActionResult) {
	if (result.type === 'error') {
		toast.error('Could not complete the request. Check your connection and try again.');
	} else if (result.type === 'failure') {
		toast.error(
			typeof result.data?.error === 'string' ? result.data.error : 'Could not save these changes.'
		);
	} else if (result.type === 'success') {
		const consolidated = result.data?.consolidated;
		if (consolidated) {
			if (consolidated.removed === 0) toast.info('No duplicate secrets found.');
			else
				toast.success(
					`Consolidated ${consolidated.removed} duplicate secrets and updated ${consolidated.mappingsUpdated} mappings.`
				);
		} else if (result.data?.saved) toast.success('Configuration saved.');
	}
}

export const secretForm: SubmitFunction =
	() =>
	async ({ result, update }) => {
		notifySecretAction(result);
		if (result.type !== 'error') await update();
	};
