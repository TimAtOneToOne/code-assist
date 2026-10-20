import { fail, type RequestEvent } from '@sveltejs/kit';
import {
	consolidateSecrets,
	deleteMapping,
	deleteSecret,
	listConfiguration,
	saveMapping,
	saveSecret,
	SecretInputError
} from '@code-assist/secrets';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { listRepositories } from '#lib/server/repositories.js';
import type { Actions, PageServerLoad } from './$types';
import { readAwsSettings } from '@code-assist/intake/aws-settings';
import { readSettings } from '@code-assist/intake/settings';

export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	event.setHeaders({ 'Cache-Control': 'no-store' });
	let repositories: Awaited<ReturnType<typeof listRepositories>> = [];
	let repositoryError = '';
	try {
		repositories = await listRepositories(dataDirectory());
	} catch {
		repositoryError = 'Cannot read the repository folder. Check Mac mini settings.';
	}
	return { ...listConfiguration(dataDirectory()), repositories, repositoryError };
};

async function mutate(
	event: RequestEvent,
	change: (field: (name: string) => string) => void | Promise<void>
) {
	await requireSettingsAccess(event);
	const form = await event.request.formData();
	const field = (name: string) => {
		const value = form.get(name);
		return typeof value === 'string' ? value : '';
	};
	try {
		await change(field);
		return { saved: true };
	} catch (error) {
		if (error instanceof SecretInputError) return fail(400, { error: error.message });
		throw error;
	}
}

export const actions = {
	consolidate: async (event) => {
		await requireSettingsAccess(event);
		return { consolidated: consolidateSecrets(dataDirectory()) };
	},
	saveSecret: (event) =>
		mutate(event, (field) => {
			saveSecret(dataDirectory(), {
				id: field('id') || undefined,
				name: field('name'),
				description: field('description'),
				value: field('value')
			});
		}),
	deleteSecret: (event) =>
		mutate(event, (field) => {
			const settings = readSettings(dataDirectory());
			if (
				settings &&
				[
					settings.linearSecretId,
					settings.teamsWebhookSecretId,
					settings.teamsConversationSecretId
				].includes(field('id'))
			) {
				throw new SecretInputError(
					'Choose a different secret in intake settings before deleting this one.'
				);
			}
			const aws = readAwsSettings(dataDirectory());
			if (aws && [aws.accessKeySecretId, aws.secretAccessKeySecretId].includes(field('id')))
				throw new SecretInputError(
					'Choose a different key in AWS staging settings before deleting this one.'
				);
			deleteSecret(dataDirectory(), field('id'));
		}),
	saveMapping: (event) =>
		mutate(event, async (field) => {
			const repository = field('repository');
			const repositories = await listRepositories(dataDirectory());
			if (!repositories.some((r) => r.path === repository))
				throw new SecretInputError('Choose a repository from the configured clone folder.');
			saveMapping(dataDirectory(), {
				repository,
				variable: field('variable').trim(),
				secretId: field('secretId')
			});
		}),
	deleteMapping: (event) =>
		mutate(event, (field) => {
			deleteMapping(dataDirectory(), field('repository'), field('variable'));
		})
} satisfies Actions;
