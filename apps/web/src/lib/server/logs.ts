import { error, type RequestEvent } from '@sveltejs/kit';
import { createLogger } from '@code-assist/observability';
import { parseFilters, searchLogs } from '@code-assist/observability/search';
import { CODE_ASSIST_LOG_SEARCH_URL, CODE_ASSIST_LOG_SEARCH_AUTH } from '$app/env/private';
import { requireSettingsAccess } from './settings-access.js';

export const logger = createLogger('web');

export async function loadLogs(event: RequestEvent) {
	await requireSettingsAccess(event);
	if (!CODE_ASSIST_LOG_SEARCH_URL || !CODE_ASSIST_LOG_SEARCH_AUTH)
		error(503, 'Log search has not been configured.');
	let filters;
	try {
		filters = parseFilters(event.url.searchParams);
	} catch {
		error(400, 'Invalid time range or page offset.');
	}
	try {
		return await searchLogs(CODE_ASSIST_LOG_SEARCH_URL, CODE_ASSIST_LOG_SEARCH_AUTH, filters);
	} catch (cause) {
		logger.event('error', 'logs.search_failed', 'Log search unavailable', { error: cause });
		error(503, 'Log search is unavailable. Local evidence files remain on the Mac mini.');
	}
}
