import { error, json } from '@sveltejs/kit';
import { revealSecret, SecretInputError } from '@code-assist/secrets';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import { dataDirectory } from '#lib/server/data-directory.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	await requireSettingsAccess(event);
	try {
		return json(
			{ value: revealSecret(dataDirectory(), event.params.id) },
			{
				headers: { 'Cache-Control': 'no-store' }
			}
		);
	} catch (cause) {
		if (cause instanceof SecretInputError) error(404, cause.message);
		throw cause;
	}
};
