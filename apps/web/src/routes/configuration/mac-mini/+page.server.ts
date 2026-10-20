import { fail } from '@sveltejs/kit';
import { dataDirectory } from '#lib/server/data-directory.js';
import {
	readMacMiniConfig,
	validateRepositoryRoot,
	writeMacMiniConfig
} from '#lib/server/mac-mini-config.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { logger } from '#lib/server/logs.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	return { config: await readMacMiniConfig(dataDirectory()) };
};

export const actions = {
	default: async (event) => {
		await requireSettingsAccess(event);
		const data = await event.request.formData();
		const value = data.get('repositoryRoot');
		const repositoryRoot = typeof value === 'string' ? value.trim() : '';
		const validationError = await validateRepositoryRoot(repositoryRoot);
		if (validationError) return fail(400, { repositoryRoot, error: validationError });
		await writeMacMiniConfig(dataDirectory(), { repositoryRoot });
		logger
			.child({ request_id: event.locals.requestId })
			.event('info', 'configuration.saved', 'Repository root updated', {
				repository_root: repositoryRoot
			});
		return { repositoryRoot, saved: true };
	}
} satisfies Actions;
