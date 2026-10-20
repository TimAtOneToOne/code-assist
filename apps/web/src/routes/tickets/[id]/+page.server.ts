import { error, fail } from '@sveltejs/kit';
import { readWorkItem, selectRepositories, SelectionConflict } from '@code-assist/intake';
import {
	answerDiscovery,
	retryDiscovery,
	reconcileDiscoveryFailures,
	DiscoveryConflict
} from '@code-assist/intake/discovery';
import { discoverRepositories } from '@code-assist/intake/repositories';
import { withController } from '#lib/server/intake.js';
import { dataDirectory } from '#lib/server/data-directory.js';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { renderMarkdown } from '#lib/server/markdown.js';
import type { Actions, PageServerLoad } from './$types';
function issueId(id: string) {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
		error(404, 'Ticket not found.');
	return id;
}
export const load: PageServerLoad = async (event) => {
	await requireSettingsAccess(event);
	const item = await withController(async (boss) => {
		await reconcileDiscoveryFailures(boss);
		return readWorkItem(boss.getDb(), issueId(event.params.id));
	});
	if (!item) error(404, 'Ticket not found.');
	return {
		item,
		discoverySummaries: Object.fromEntries(
			item.discoveries
				.filter((run) => run.result)
				.map((run) => [run.id, renderMarkdown(run.result!.summary)])
		),
		descriptionHtml: renderMarkdown(item.ticket.description),
		comments: item.ticket.comments.map((comment) => ({
			id: comment.id,
			html: renderMarkdown(comment.body)
		})),
		repositories: await discoverRepositories(dataDirectory())
	};
};
export const actions = {
	default: async (event) => {
		await requireSettingsAccess(event);
		const form = await event.request.formData();
		const id = issueId(event.params.id);
		if (form.get('intent') === 'answers' || form.get('intent') === 'retry') {
			const runId = form.get('runId');
			if (typeof runId !== 'string') return fail(400, { error: 'Choose a discovery run.' });
			issueId(runId);
			try {
				if (form.get('intent') === 'retry') {
					await withController((boss) => retryDiscovery(boss, id, runId));
					return { message: 'Codex discovery queued again.' };
				}
				const answers = form.getAll('answer'),
					notes = form.get('notes') ?? '';
				if (
					form.get('scope') !== 'confirmed' ||
					!answers.every((answer) => typeof answer === 'string') ||
					typeof notes !== 'string'
				)
					return fail(400, { error: 'Answer the questions and confirm the repository scope.' });
				await withController((boss) =>
					answerDiscovery(boss, id, runId, answers as string[], notes)
				);
				return {
					message:
						'Scope and answers saved. Ready for the planning cycle; planning has not started.'
				};
			} catch (cause) {
				if (cause instanceof DiscoveryConflict) return fail(409, { error: cause.message });
				throw cause;
			}
		}
		const selected = form.getAll('repositories'),
			updatedAt = form.get('updatedAt');
		const repositories = await discoverRepositories(dataDirectory());
		if (
			!selected.length ||
			new Set(selected).size !== selected.length ||
			!selected.every(
				(path) => typeof path === 'string' && repositories.some((r) => r.path === path)
			) ||
			typeof updatedAt !== 'string'
		)
			return fail(400, {
				error: 'Choose one or more repositories from the configured clone folder.'
			});
		const item = await withController((boss) => readWorkItem(boss.getDb(), id));
		if (!item || item.ticket.updatedAt !== updatedAt)
			return fail(409, {
				error: 'The ticket changed. Refresh and review it before selecting repositories.'
			});
		try {
			await withController((boss) => selectRepositories(boss, id, selected as string[], updatedAt));
		} catch (cause) {
			if (cause instanceof SelectionConflict) return fail(409, { error: cause.message });
			throw cause;
		}
		return {
			message: 'Repositories saved. Codex discovery will run when the ticket has Plan without Code.'
		};
	}
} satisfies Actions;
