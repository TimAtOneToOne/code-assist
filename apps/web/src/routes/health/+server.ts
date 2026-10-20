import { CODE_ASSIST_COMMIT } from '$app/env/private';

export function GET() {
	return Response.json({ status: 'ok', commit: CODE_ASSIST_COMMIT ?? null });
}
