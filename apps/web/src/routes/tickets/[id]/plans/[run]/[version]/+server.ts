import { error } from '@sveltejs/kit';
import { readPlanning, planningArtifact } from '@code-assist/intake/planning';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { withController } from '#lib/server/intake.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async (event) => {
	await requireSettingsAccess(event);
	if (!/^[a-f0-9-]{36}$/i.test(event.params.id)) error(404, 'Plan not found.');
	const runs = await withController((boss) => readPlanning(boss.getDb(), event.params.id));
	const plan = runs
		.find((r) => r.id === event.params.run)
		?.versions.find((v) => v.number === Number(event.params.version));
	if (!plan) error(404, 'Plan not found.');
	const kind = event.url.searchParams.get('artifact') ?? 'plan';
	if (kind !== 'plan' && kind !== 'reasoning' && kind !== 'claude_feedback')
		error(404, 'Planning artifact not found.');
	const artifact = planningArtifact(plan, kind);
	if (!artifact) error(404, 'Planning artifact not found.');
	return new Response(artifact.content, {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'content-disposition': `attachment; filename="${artifact.name}"`,
			'cache-control': 'no-store'
		}
	});
};
