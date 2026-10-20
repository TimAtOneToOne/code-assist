import { error } from '@sveltejs/kit';
import { CODE_ASSIST_DATABASE_URL } from '$app/env/private';
import { withIntake } from '@code-assist/intake';
export function withController<T>(action: Parameters<typeof withIntake<T>>[1]) {
	if (!CODE_ASSIST_DATABASE_URL) error(503, 'The job database has not been configured.');
	return withIntake(CODE_ASSIST_DATABASE_URL, action);
}
