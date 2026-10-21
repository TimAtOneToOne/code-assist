import { error, fail } from '@sveltejs/kit';
import {
	emptyRepositorySetup,
	profileHash,
	readRepositorySetup,
	RepositorySettingsError,
	writeRepositorySetup
} from '@code-assist/intake/repository-settings';
import {
	cleanupSetupTest,
	readSetupTests,
	requestSetupTest
} from '@code-assist/intake/repository-setup-tests';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { listRepositories } from '#lib/server/repositories.js';
import { withController } from '#lib/server/intake.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	const directory = dataDirectory();
	const repositories = (await listRepositories(directory)).map((repo) => ({
		...repo,
		configured: !!readRepositorySetup(directory, repo.path).configuration
	}));
	const repository = event.url.searchParams.get('repository');
	if (repository && !repositories.some((r) => r.path === repository))
		error(404, 'Repository not found.');
	const settings = repository ? readRepositorySetup(directory, repository) : null;
	return {
		repositories,
		repository,
		configuration: settings?.configuration ?? emptyRepositorySetup(),
		configured: !!settings?.configuration,
		custom: settings?.custom ?? false,
		hash: settings?.configuration ? profileHash(settings.configuration) : null,
		tests: repository
			? await withController((boss) => readSetupTests(boss, directory, repository))
			: []
	};
};
export const actions = {
	save: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const repository = String(form.get('repository'));
		if (!(await listRepositories(dataDirectory())).some((r) => r.path === repository))
			return fail(400, { error: 'Choose an available repository.' });
		try {
			const configuration = {
				...Object.fromEntries(
					[
						'workingDirectory',
						'systemSetupScript',
						'setupScript',
						'validationScript',
						'browserDirectory',
						'browserInstallScript',
						'startScript',
						'readyScript',
						'smokeScript',
						'instructions'
					].map((key) => [key, String(form.get(key) ?? '')])
				),
				environment: JSON.parse(String(form.get('environment') ?? '{}')),
				generatedVariables: String(form.get('generatedVariables') ?? '')
					.split(/[\s,]+/)
					.filter(Boolean)
			};
			writeRepositorySetup(dataDirectory(), repository, configuration);
		} catch (err) {
			if (err instanceof RepositorySettingsError || err instanceof SyntaxError)
				return fail(400, {
					error: err instanceof SyntaxError ? 'Local overrides must be valid JSON.' : err.message
				});
			throw err;
		}
		if (form.get('intent') === 'test') {
			const id = await withController((boss) =>
				requestSetupTest(boss, dataDirectory(), repository)
			);
			return { saved: true, queued: id };
		}
		return { saved: true };
	},
	cleanup: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const id = String(form.get('id'));
		if (!/^[a-f0-9-]{36}$/.test(id)) return fail(400, { error: 'Invalid setup test.' });
		await withController((boss) => cleanupSetupTest(boss, dataDirectory(), id));
		return { cleaned: true };
	}
} satisfies Actions;
