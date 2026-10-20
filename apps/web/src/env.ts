import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	CODE_ASSIST_COMMIT: { schema: (value) => value ?? null },
	CODE_ASSIST_DATA_DIR: { schema: (value) => value ?? null },
	CODE_ASSIST_ADMIN_TAILSCALE_USER: { schema: (value) => value ?? null }
});
