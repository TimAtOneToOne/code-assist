import { error, fail } from '@sveltejs/kit';
import {
	isPromptScope,
	readPromptSettings,
	writePromptSetting
} from '@code-assist/intake/prompt-settings';
import {
	promptDefinitions,
	promptText,
	repositoryScopes
} from '@code-assist/intake/prompt-defaults';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { listRepositories } from '#lib/server/repositories.js';
import type { Actions, PageServerLoad } from './$types';

async function promptContext() {
	const settings = readPromptSettings(dataDirectory());
	const repositories = await listRepositories(dataDirectory());
	for (const path of Object.keys(settings.repositories)) {
		if (!repositories.some((repo) => repo.path === path))
			repositories.push({ name: `${path.split('/').at(-1)} (unavailable)`, path });
	}
	return { settings, repositories };
}

export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	event.setHeaders({ 'Cache-Control': 'no-store' });
	const { settings, repositories } = await promptContext();
	const scope = event.url.searchParams.get('scope') ?? 'global';
	const repository = event.url.searchParams.get('repository') || undefined;
	if (
		!isPromptScope(scope) ||
		(repository &&
			(!(repositoryScopes as readonly string[]).includes(scope) ||
				!repositories.some((repo) => repo.path === repository)))
	)
		error(404, 'Prompt not found.');
	return {
		scope,
		repository,
		repositories,
		definition: promptDefinitions[scope],
		text: promptText(settings, scope, repository),
		custom: repository
			? Object.hasOwn(settings.repositories[repository] ?? {}, scope)
			: Object.hasOwn(settings.prompts, scope)
	};
};

export const actions = {
	save: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const scope = form.get('scope');
		const repository = form.get('repository') || undefined;
		const text = form.get('text');
		const reset = form.get('intent') === 'reset';
		const { repositories } = await promptContext();
		if (
			typeof scope !== 'string' ||
			!isPromptScope(scope) ||
			typeof text !== 'string' ||
			(repository !== undefined &&
				(typeof repository !== 'string' ||
					!(repositoryScopes as readonly string[]).includes(scope) ||
					!repositories.some((repo) => repo.path === repository)))
		)
			return fail(400, { error: 'Choose a valid prompt and repository.' });
		writePromptSetting(dataDirectory(), scope, reset ? null : text, repository);
		return { saved: true, scope, repository, reset };
	}
} satisfies Actions;
