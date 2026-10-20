import { CODE_ASSIST_COMMIT } from '$app/env/private';

export function load() {
	return { commit: CODE_ASSIST_COMMIT ?? null };
}
