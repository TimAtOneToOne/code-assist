import { resolve } from 'node:path';
import { dev } from '$app/env';
import { CODE_ASSIST_DATA_DIR } from '$app/env/private';
import { error } from '@sveltejs/kit';

export function dataDirectory() {
	if (CODE_ASSIST_DATA_DIR) return CODE_ASSIST_DATA_DIR;
	if (dev) return resolve('../../.tmp/local-web-data');
	error(503, 'Settings storage has not been configured.');
}
