import { error } from '@sveltejs/kit';
import { CODE_ASSIST_DATABASE_URL } from '$app/env/private';
import { dashboardEvents } from '@code-assist/intake/dashboard-events';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	await requireSettingsAccess(event);
	if (!CODE_ASSIST_DATABASE_URL) error(503, 'The job database has not been configured.');
	return new Response(dashboardEvents(CODE_ASSIST_DATABASE_URL, event.request.signal), {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-store'
		}
	});
};
