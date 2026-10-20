import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const defaultRepositoryRoot = '/Users/miasocci/CODE/repos/OnetoOneHealth';
export type MacMiniConfig = { repositoryRoot: string };

export async function readMacMiniConfig(directory: string): Promise<MacMiniConfig> {
	try {
		const config = JSON.parse(await readFile(join(directory, 'mac-mini.json'), 'utf8'));
		if (typeof config.repositoryRoot !== 'string' || !isAbsolute(config.repositoryRoot)) {
			throw new Error('Invalid saved Mac mini configuration');
		}
		return { repositoryRoot: config.repositoryRoot };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return { repositoryRoot: defaultRepositoryRoot };
		}
		throw error;
	}
}

export async function validateRepositoryRoot(value: string): Promise<string | null> {
	if (!isAbsolute(value)) return 'Enter an absolute folder path on the Mac mini.';
	try {
		if (!(await stat(value)).isDirectory()) return 'Choose a folder, not a file.';
		await access(value, constants.R_OK | constants.X_OK);
		return null;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR')
			return 'That folder does not exist on the Mac mini.';
		if (code === 'EACCES' || code === 'EPERM') return 'Code Assist cannot read that folder.';
		throw error;
	}
}

export async function writeMacMiniConfig(directory: string, config: MacMiniConfig): Promise<void> {
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `mac-mini.${randomUUID()}.tmp`);
	try {
		await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
		await rename(temporary, join(directory, 'mac-mini.json'));
	} finally {
		await rm(temporary, { force: true });
	}
}
