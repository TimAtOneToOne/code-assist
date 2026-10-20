import { resolve } from 'node:path';
import { dev } from '$app/env';
import { CODE_ASSIST_DATA_DIR } from '$app/env/private';
import { error, fail } from '@sveltejs/kit';
import {
	readMacMiniConfig,
	validateRepositoryRoot,
	writeMacMiniConfig
} from '#lib/server/mac-mini-config.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';

function dataDirectory() {
	if (CODE_ASSIST_DATA_DIR) return CODE_ASSIST_DATA_DIR;
	if (dev) return resolve('../../.tmp/local-web-data');
	error(503, 'Settings storage has not been configured.');
}

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
		return { repositoryRoot, saved: true };
	}
} satisfies Actions;
