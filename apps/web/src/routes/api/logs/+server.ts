import { json } from '@sveltejs/kit';
import { loadLogs } from '#lib/server/logs.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) =>
	json(await loadLogs(event), { headers: { 'Cache-Control': 'no-store' } });
