import { error } from '@sveltejs/kit';
import { readPlanning } from '@code-assist/intake/planning';
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
	return new Response(plan.document.markdown, {
		headers: {
			'content-type': 'text/markdown; charset=utf-8',
			'content-disposition': `attachment; filename="plan_v${plan.number}.md"`,
			'cache-control': 'no-store'
		}
	});
};
