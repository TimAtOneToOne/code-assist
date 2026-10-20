import { error, fail } from '@sveltejs/kit';
import { readWorkItem, selectRepository, SelectionConflict } from '@code-assist/intake';
import { discoverRepositories } from '@code-assist/intake/repositories';
import { withController } from '#lib/server/intake.js';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { Actions, PageServerLoad } from './$types';
function issueId(id: string) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
		error(404, 'Ticket not found.');
	return id;
}
export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	const item = await withController((boss) => readWorkItem(boss.getDb(), issueId(event.params.id)));
	if (!item) error(404, 'Ticket not found.');
	return { item, repositories: await discoverRepositories(dataDirectory()) };
};
export const actions = {
	default: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const repository = form.get('repository'),
			updatedAt = form.get('updatedAt');
		const repositories = await discoverRepositories(dataDirectory());
		if (
			typeof repository !== 'string' ||
			!repositories.some((r) => r.path === repository) ||
			typeof updatedAt !== 'string'
		)
			return fail(400, { error: 'Choose a repository from the configured clone folder.' });
		const id = issueId(event.params.id);
		const item = await withController((boss) => readWorkItem(boss.getDb(), id));
		if (!item || item.ticket.updatedAt !== updatedAt)
			return fail(409, {
				error: 'The ticket changed. Refresh and review it before selecting a repository.'
			});
		try {
			await withController((boss) => selectRepository(boss, id, repository, updatedAt));
		} catch (cause) {
			if (cause instanceof SelectionConflict) return fail(409, { error: cause.message });
			throw cause;
		}
		return { saved: true };
	}
} satisfies Actions;
