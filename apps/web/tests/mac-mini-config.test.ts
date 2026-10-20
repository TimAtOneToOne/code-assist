import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
	defaultRepositoryRoot,
	readMacMiniConfig,
	validateRepositoryRoot,
	writeMacMiniConfig
} from '../src/lib/server/mac-mini-config.ts';

async function fixture() {
	const parent = fileURLToPath(new URL('../../../.tmp/mac-mini-config-tests/', import.meta.url));
	await mkdir(parent, { recursive: true });
	return mkdtemp(join(parent, 'config-'));
}

test('a fresh installation offers the requested clone root', async (t) => {
	const directory = await fixture();
	t.after(() => rm(directory, { recursive: true, force: true }));
	assert.deepEqual(await readMacMiniConfig(directory), { repositoryRoot: defaultRepositoryRoot });
});

test('a saved root survives a fresh read and supports folder names with spaces', async (t) => {
	const directory = await fixture();
	t.after(() => rm(directory, { recursive: true, force: true }));
	const repositoryRoot = join(directory, 'synced repositories');
	await mkdir(repositoryRoot);
	assert.equal(await validateRepositoryRoot(repositoryRoot), null);
	await writeMacMiniConfig(join(directory, 'data'), { repositoryRoot });
	assert.deepEqual(await readMacMiniConfig(join(directory, 'data')), { repositoryRoot });
});

test('relative paths, missing folders and files are rejected without changing saved settings', async (t) => {
	const directory = await fixture();
	t.after(() => rm(directory, { recursive: true, force: true }));
	const data = join(directory, 'data');
	await writeMacMiniConfig(data, { repositoryRoot: directory });
	const file = join(directory, 'file.txt');
	await writeFile(file, '');
	for (const invalid of ['', 'relative/path', join(directory, 'missing'), file]) {
		assert.equal(typeof (await validateRepositoryRoot(invalid)), 'string');
	}
	assert.deepEqual(await readMacMiniConfig(data), { repositoryRoot: directory });
});

test('corrupt saved settings are reported rather than silently replaced with defaults', async (t) => {
	const directory = await fixture();
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, 'mac-mini.json'), '{');
	await assert.rejects(readMacMiniConfig(directory));
});
