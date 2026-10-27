import { fail } from '@sveltejs/kit';
import {
	ExecutionSettingsError,
	readExecutionSettings,
	writeExecutionSettings
} from '@code-assist/intake/execution-settings';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	event.setHeaders({ 'Cache-Control': 'no-store' });
	return { settings: readExecutionSettings(dataDirectory()) };
};
export const actions = {
	save: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const value = form.get('maxParallelDiscoveries');
		try {
			writeExecutionSettings(dataDirectory(), {
				maxParallelDiscoveries: typeof value === 'string' && value.trim() ? Number(value) : NaN
			});
			return { saved: true };
		} catch (error) {
			if (error instanceof ExecutionSettingsError) return fail(400, { error: error.message });
			throw error;
		}
	}
} satisfies Actions;
