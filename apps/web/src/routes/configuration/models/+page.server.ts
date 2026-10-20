import { fail } from '@sveltejs/kit';
import {
	ModelSettingsError,
	readModelSettings,
	writeModelSettings
} from '@code-assist/intake/model-settings';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	event.setHeaders({ 'Cache-Control': 'no-store' });
	return { settings: readModelSettings(dataDirectory()) };
};

export const actions = {
	save: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const codex = form.get('codex');
		const claude = form.get('claude');
		if (typeof codex !== 'string' || typeof claude !== 'string')
			return fail(400, { error: 'Enter a model ID for both providers.' });
		try {
			writeModelSettings(dataDirectory(), { codex, claude });
			return { saved: true };
		} catch (error) {
			if (error instanceof ModelSettingsError) return fail(400, { error: error.message });
			throw error;
		}
	}
} satisfies Actions;
