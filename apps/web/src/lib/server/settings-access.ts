import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dev } from '$app/env';
import { CODE_ASSIST_ADMIN_TAILSCALE_USER } from '$app/env/private';
import { error, type RequestEvent } from '@sveltejs/kit';

const execute = promisify(execFile);

export async function requireSettingsAccess(event: RequestEvent) {
	const address = event.getClientAddress().replace(/^::ffff:/, '');
	if (dev && (address === '127.0.0.1' || address === '::1')) return;
	if (!CODE_ASSIST_ADMIN_TAILSCALE_USER) error(503, 'Settings access has not been configured.');

	let identity: { Node?: { User?: number; Tags?: string[] }; UserProfile?: { ID?: number } };
	try {
		const { stdout } = await execute('/Applications/Tailscale.app/Contents/MacOS/Tailscale', [
			'whois',
			'--json',
			address
		]);
		identity = JSON.parse(stdout);
	} catch {
		error(403, 'Connect from a Tailscale device registered to the workspace owner.');
	}
	if (
		identity.Node?.Tags?.length ||
		String(identity.Node?.User) !== CODE_ASSIST_ADMIN_TAILSCALE_USER ||
		String(identity.UserProfile?.ID) !== CODE_ASSIST_ADMIN_TAILSCALE_USER
	) {
		error(403, 'Only the workspace owner can access these settings.');
	}
}
