import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { CODE_ASSIST_ARTIFACT_DIR } from '$app/env/private';
import { artifactPath } from '@code-assist/observability/artifacts';
import { requireSettingsAccess } from '#lib/server/settings-access.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	await requireSettingsAccess(event);
	if (!CODE_ASSIST_ARTIFACT_DIR) error(503, 'Artifact storage is not configured.');
	let path;
	try {
		path = artifactPath(CODE_ASSIST_ARTIFACT_DIR, event.params.id);
	} catch {
		error(400, 'Invalid artifact ID.');
	}
	let file;
	try {
		file = await open(path, 'r');
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') error(404, 'Artifact not found.');
		throw cause;
	}
	const stat = await file.stat();
	return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Length': String(stat.size),
			'Content-Disposition': `attachment; filename="${event.params.id}.json"`,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
