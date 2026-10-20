import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readMacMiniConfig } from './mac-mini-config.js';

export async function listRepositories(directory: string) {
	const { repositoryRoot } = await readMacMiniConfig(directory);
	const entries = await readdir(repositoryRoot, { withFileTypes: true });
	const repositories: { name: string; path: string }[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const path = join(repositoryRoot, entry.name);
		try {
			await stat(join(path, '.git'));
			repositories.push({ name: entry.name, path });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
	}
	return repositories.sort((a, b) => a.name.localeCompare(b.name));
}
