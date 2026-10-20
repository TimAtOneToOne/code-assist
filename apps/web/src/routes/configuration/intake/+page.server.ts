import { fail } from '@sveltejs/kit';
import { listConfiguration } from '@code-assist/secrets';
import { readSettings, writeSettings, type IntakeSettings } from '@code-assist/intake/settings';
import { reconcileSchedule } from '@code-assist/intake/worker';
import { withController } from '#lib/server/intake.js';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	return {
		settings: readSettings(dataDirectory()),
		secrets: listConfiguration(dataDirectory()).secrets
	};
};
export const actions = {
	default: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const text = (key: string) =>
			typeof form.get(key) === 'string' ? (form.get(key) as string) : '';
		const settings = {
			linearSecretId: text('linearSecretId'),
			linearTokenType: text('linearTokenType'),
			teamsWebhookSecretId: text('teamsWebhookSecretId'),
			teamsConversationSecretId: text('teamsConversationSecretId'),
			pollMinutes: Number(text('pollMinutes'))
		} as IntakeSettings;
		try {
			writeSettings(dataDirectory(), settings);
		} catch {
			return fail(400, {
				error: 'Choose three saved secrets, a Linear token type and a polling interval.'
			});
		}
		await withController((boss) => reconcileSchedule(boss, dataDirectory()));
		return { saved: true };
	}
} satisfies Actions;
