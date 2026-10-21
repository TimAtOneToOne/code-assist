import { dashboard, requestScan, requeuePendingNotifications } from '@code-assist/intake';
import { requestGitHubRefresh } from '@code-assist/intake/github';
import { readSettings } from '@code-assist/intake/settings';
import { fail } from '@sveltejs/kit';
import { withController } from '#lib/server/intake.js';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	return { ...(await withController(dashboard)), settings: readSettings(dataDirectory()) };
};
export const actions = {
	github: async (event) => {
		await requireSettingsAccess(event);
		await withController((boss) => requestGitHubRefresh(boss));
		return { message: 'GitHub refresh queued. Results will update automatically.' };
	},
	check: async (event) => {
		await requireSettingsAccess(event);
		if (!readSettings(dataDirectory()))
			return fail(400, { error: 'Configure the Linear connection first.' });
		await withController(requestScan);
		return { message: 'Linear check queued. Results will update automatically.' };
	},
	notifications: async (event) => {
		await requireSettingsAccess(event);
		await withController(requeuePendingNotifications);
		return { message: 'Pending notifications queued for another attempt.' };
	}
} satisfies Actions;
