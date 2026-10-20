import { fail } from '@sveltejs/kit';
import { listConfiguration } from '@code-assist/secrets';
import {
	AwsSettingsError,
	readAwsSettings,
	writeAwsSettings,
	type AwsSettings
} from '@code-assist/intake/aws-settings';
import { testAwsSettings } from '@code-assist/intake/planning-aws';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	event.setHeaders({ 'Cache-Control': 'no-store' });
	return {
		settings: readAwsSettings(dataDirectory()),
		secrets: listConfiguration(dataDirectory()).secrets
	};
};
export const actions = {
	save: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const text = (key: string) =>
			typeof form.get(key) === 'string' ? (form.get(key) as string).trim() : '';
		const settings: AwsSettings = {
			accessKeySecretId: text('accessKeySecretId'),
			secretAccessKeySecretId: text('secretAccessKeySecretId'),
			accountId: text('accountId'),
			roleArn: text('roleArn'),
			region: text('region'),
			profile: text('profile')
		};
		try {
			writeAwsSettings(dataDirectory(), settings);
		} catch (error) {
			if (error instanceof AwsSettingsError) return fail(400, { error: error.message });
			throw error;
		}
		return { saved: true };
	},
	test: async (event) => {
		await requireSettingsAccess(event);
		const settings = readAwsSettings(dataDirectory());
		if (!settings) return fail(400, { error: 'Save the staging connection first.' });
		try {
			return { identity: await testAwsSettings(dataDirectory(), settings, event.request.signal) };
		} catch {
			return fail(400, {
				error:
					'Could not assume and verify the saved staging role. Check its trust policy, saved keys, account and region. Expired or revoked source keys must be replaced in Secrets.'
			});
		}
	}
} satisfies Actions;
