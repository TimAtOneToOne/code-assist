import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	CODE_ASSIST_COMMIT: { schema: (value) => value ?? null }
});
