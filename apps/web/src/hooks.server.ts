import { randomUUID } from 'node:crypto';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { logger } from '#lib/server/logs.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.requestId = randomUUID();
	const started = performance.now();
	const response = await resolve(event);
	logger
		.child({ request_id: event.locals.requestId })
		.event(
			response.status >= 500 ? 'error' : 'info',
			'http.request',
			`${event.request.method} ${event.route.id ?? '(unmatched)'} → ${response.status}`,
			{
				method: event.request.method,
				route: event.route.id,
				status: response.status,
				duration_ms: Math.round(performance.now() - started)
			}
		);
	response.headers.set('x-request-id', event.locals.requestId);
	if (
		event.route.id === '/' ||
		event.route.id?.startsWith('/tickets/') ||
		event.route.id?.startsWith('/configuration/')
	) {
		response.headers.set('Cache-Control', 'no-store');
	}
	return response;
};

export const handleError: HandleServerError = ({ error, event, kind }) => {
	try {
		logger
			.child({ request_id: event.locals.requestId })
			.event(kind === 'unknown' ? 'error' : 'warn', 'http.error', 'Server request error', {
				error,
				kind,
				route: event.route.id
			});
	} catch {
		// SvelteKit requires this hook never to throw, including when the disk is full.
		console.error('Unable to persist server-error evidence');
	}
	return { requestId: event.locals.requestId };
};
