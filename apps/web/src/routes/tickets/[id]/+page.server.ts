import {
	retryCoding,
	changeCodingBranch,
	requestCodingChanges,
	CodingConflict
} from '@code-assist/intake/coding';
import { requestGitHubRefresh } from '@code-assist/intake/github';
import { reconcileCodingFailures } from '@code-assist/intake/coding-worker';
import {
	approvePlan,
	submitPlanFeedback,
	retryPlanning,
	reconcilePlanningFailures,
	PlanningConflict
} from '@code-assist/intake/planning';
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
import { renderPlanChanges } from '#lib/server/plan-changes.js';
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
		await reconcilePlanningFailures(boss);
		await reconcileCodingFailures(boss);
		return readWorkItem(boss.getDb(), issueId(event.params.id));
	});
	if (!item) error(404, 'Ticket not found.');
	return {
		item,
		planChanges: Object.fromEntries(
			item.planning.flatMap((run) =>
				run.versions.flatMap((version, index) =>
					index === 0
						? []
						: [
								[
									`${run.id}:${version.number}`,
									{
										previousVersion: run.versions[index - 1].number,
										...renderPlanChanges(
											run.versions[index - 1].document.markdown,
											version.document.markdown
										)
									}
								]
							]
				)
			)
		),
		planHtml: Object.fromEntries(
			item.planning.flatMap((run) =>
				run.versions.flatMap((v) => {
					const key = `${run.id}:${v.number}`;
					return [
						[key, renderMarkdown(v.document.markdown)],
						[`${key}:summary`, renderMarkdown(v.review?.summary ?? '')],
						[`${key}:direction`, renderMarkdown(v.review?.directionQuestion ?? '')],
						...v.document.responses.map((response, index) => [
							`${key}:response:${index}`,
							renderMarkdown(response.response)
						]),
						...(v.review?.findings ?? []).flatMap((finding, index) => [
							[`${key}:finding:${index}:detail`, renderMarkdown(finding.detail)],
							[`${key}:finding:${index}:recommendation`, renderMarkdown(finding.recommendation)]
						])
					];
				})
			)
		),
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
		const approver = await requireSettingsAccess(event);
		const form = await event.request.formData();
		const id = issueId(event.params.id);
		if (form.get('intent') === 'coding-changes' || form.get('intent') === 'coding-main') {
			const bringMain = form.get('intent') === 'coding-main';
			try {
				await withController((boss) =>
					requestCodingChanges(
						boss,
						id,
						issueId(String(form.get('codingId'))),
						issueId(String(form.get('stepId'))),
						bringMain
							? 'Bring in the latest main changes. Preserve upstream changes and the approved feature, resolve conflicts, and rerun validation and review.'
							: String(form.get('changes') ?? ''),
						approver,
						bringMain ? 'bring_in_main' : undefined
					)
				);
				return {
					message: bringMain
						? 'Bring In Main queued. Codex will merge main and resolve conflicts, then validation and Claude review will run before updating the existing PR.'
						: 'Code changes queued. Codex will revise, then validation and Claude review will run before updating the existing PR.'
				};
			} catch (cause) {
				if (cause instanceof CodingConflict) return fail(409, { error: cause.message });
				throw cause;
			}
		}
		if (form.get('intent') === 'github-refresh') {
			try {
				await withController((boss) =>
					requestGitHubRefresh(boss, id, issueId(String(form.get('codingId'))))
				);
				return { message: 'GitHub refresh queued. Refresh the coding panel to see the result.' };
			} catch (cause) {
				if (cause instanceof CodingConflict) return fail(409, { error: cause.message });
				throw cause;
			}
		}
		if (form.get('intent') === 'coding-retry' || form.get('intent') === 'coding-branch') {
			try {
				if (form.get('intent') === 'coding-branch') {
					await withController((boss) =>
						changeCodingBranch(
							boss,
							dataDirectory(),
							id,
							issueId(String(form.get('codingId'))),
							issueId(String(form.get('stepId'))),
							String(form.get('branch') ?? '').trim()
						)
					);
					return { message: 'Branch updated and coding queued.' };
				}
				await withController((boss) =>
					retryCoding(
						boss,
						id,
						issueId(String(form.get('codingId'))),
						issueId(String(form.get('stepId')))
					)
				);
				return { message: 'Coding step queued again.' };
			} catch (cause) {
				if (cause instanceof CodingConflict) return fail(409, { error: cause.message });
				throw cause;
			}
		}
		if (String(form.get('intent')).startsWith('plan-')) {
			const runId = String(form.get('planningId') ?? '');
			issueId(runId);
			const intent = form.get('intent');
			try {
				if (intent === 'plan-retry') {
					const stepId = issueId(String(form.get('stepId') ?? ''));
					await withController((boss) => retryPlanning(boss, id, runId, stepId));
					return { message: 'Planning step queued again.' };
				}
				const version = Number(form.get('version')),
					hash = String(form.get('hash') ?? '');
				if (!Number.isSafeInteger(version) || version < 1 || !/^[a-f0-9]{64}$/.test(hash))
					return fail(400, { error: 'Choose a saved plan version.' });
				if (intent === 'plan-approve') {
					if (form.get('authorization') !== 'confirmed')
						return fail(400, { error: 'Confirm authorization for this exact plan version.' });
					const accepted = form.getAll('acceptedMedium');
					if (!accepted.every((value) => typeof value === 'string'))
						return fail(400, { error: 'Invalid concern selection.' });
					await withController((boss) =>
						approvePlan(boss, id, runId, version, hash, accepted as string[], approver)
					);
					return {
						message: 'Plan approved. Supported repositories enter the coding workflow.'
					};
				}
				if (intent !== 'plan-feedback') return fail(400, { error: 'Unknown planning action.' });
				await withController((boss) =>
					submitPlanFeedback(boss, id, runId, version, hash, String(form.get('feedback') ?? ''))
				);
				return { message: 'Feedback saved. Codex will create a new version for Claude to review.' };
			} catch (cause) {
				if (cause instanceof PlanningConflict) return fail(409, { error: cause.message });
				throw cause;
			}
		}
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
					message: 'Scope and answers saved. Adversarial planning is queued.'
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
