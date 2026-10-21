<script lang="ts">
	import type { PageProps } from './$types';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	let { data }: PageProps = $props();
	let search = $state('');
	let busy = $state(false);
	const filtered = $derived(
		data.repositories.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
	);
	const submit: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'error')
				toast.error('Could not complete the request. Check the logs and try again.');
			else {
				if (result.type === 'failure') toast.error(result.data?.error ?? 'Could not save setup.');
				else if (result.type === 'success')
					toast.success(
						result.data?.queued
							? 'Setup test queued. You can leave this page.'
							: result.data?.cleaned
								? 'Cleanup attempted. See the test result.'
								: 'Repository setup saved.'
					);
				await update({ reset: false });
			}
		};
	};
</script>

<svelte:head><title>Repository Setup · Code Assist</title></svelte:head>
<a class="back-link" href={resolve('/configuration')}>← Configuration</a>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Repository Setup</h1>
<p class="intro">
	Configure how repositories install, run, and validate in isolated OrbStack workspaces.
</p>
<div class="setup-layout">
	<div class="repo-picker" role="complementary" aria-label="Repositories">
		<label for="repo-search">Find a Repository</label>
		<Input id="repo-search" type="search" placeholder="Search repositories…" bind:value={search} />
		<div role="navigation" aria-label="Repository Setup" class="repository-list">
			{#each filtered as repo (repo.path)}
				<a
					class:chosen={repo.path === data.repository}
					href={resolve(`/configuration/repositories?repository=${encodeURIComponent(repo.path)}`)}
					aria-current={repo.path === data.repository ? 'page' : undefined}
				>
					<span>{repo.name}</span><Badge variant="secondary"
						>{repo.configured ? 'Configured' : 'Not Set Up'}</Badge
					>
				</a>
			{/each}
			{#if !filtered.length}<p class="muted">No matching repositories.</p>{/if}
		</div>
	</div>
	<div class="setup-editor">
		{#if data.repository}
			{#key data.repository + data.hash}
				<form
					method="POST"
					action={resolve(
						`/configuration/repositories?/save&repository=${encodeURIComponent(data.repository)}`
					)}
					use:enhance={submit}
				>
					<input type="hidden" name="repository" value={data.repository} />
					<Card.Root class="panel">
						<div class="section-heading">
							<h2>{data.repository.split('/').at(-1)}</h2>
							<Badge variant="secondary"
								>{data.custom
									? 'Saved Setup'
									: data.configured
										? 'Built-In Setup'
										: 'Not Set Up'}</Badge
							>
						</div>
						<p class="muted">
							Changes apply to new workspaces. Test Setup saves these fields, tests the synced HEAD
							commit, and removes its disposable machine afterward.
						</p>
						<label for="workingDirectory">Working Directory</label>
						<Input
							id="workingDirectory"
							name="workingDirectory"
							value={data.configuration.workingDirectory}
							required
						/>
						<p class="field-help">
							Relative to this repository, such as . or apps/portal. All command fields are Bash
							scripts and stop on the first failed command.
						</p>
						<label for="systemSetupScript">Additional System Dependencies</label>
						<Textarea
							class="font-mono text-sm"
							id="systemSetupScript"
							name="systemSetupScript"
							rows={3}
							value={data.configuration.systemSetupScript}
							placeholder="Optional toolchain installation commands"
						></Textarea>
						<p class="field-help">
							Runs as root inside the disposable Linux guest. Node, pnpm, Git, Make, PostgreSQL
							client, and a private container engine are already installed. Other command fields run
							as the workspace user.
						</p>
						<label for="gitDependencies">Pinned Git Dependencies (JSON)</label>
						<Textarea
							id="gitDependencies"
							name="gitDependencies"
							class="font-mono text-sm"
							rows={4}
							value={JSON.stringify(data.configuration.gitDependencies ?? [], null, 2)}
						/>
						<p class="field-help">
							For private modules, list synced repository names and full commit hashes: <code
								>{'{"repository":"gitops","commits":["full commit hash"]}'}</code
							> inside a JSON array. The controller copies Git objects into the guest; credentials stay
							on the controller. Dependencies are read-only and are not coding targets.
						</p>
						<label for="setupScript">Install and Service Setup</label>
						<Textarea
							class="font-mono text-sm"
							id="setupScript"
							name="setupScript"
							rows={7}
							value={data.configuration.setupScript}
							placeholder="pnpm install --frozen-lockfile&#10;docker compose up -d --wait&#10;pnpm db:migrate"
						></Textarea>
						<label for="validationScript">Validation Commands</label>
						<Textarea
							class="font-mono text-sm"
							id="validationScript"
							name="validationScript"
							rows={5}
							value={data.configuration.validationScript}
							required
							placeholder="pnpm lint&#10;pnpm check&#10;pnpm test&#10;pnpm build"
						></Textarea>
					</Card.Root>
					<Card.Root class="panel">
						<h2>Application and Browser Checks</h2>
						<p class="muted">
							Optional for repositories without a web app. A readiness check does not prove sign-in
							works; use a smoke test that exercises the real local authentication flow.
						</p>
						<label for="browserDirectory">Playwright Package Directory</label>
						<Input
							id="browserDirectory"
							name="browserDirectory"
							value={data.configuration.browserDirectory}
							placeholder="apps/portal (leave empty when unused)"
						/>
						<p class="field-help">
							Relative to the repository. Installs Chromium system dependencies using this package's
							Playwright.
						</p>
						<label for="browserInstallScript">Browser Install Commands</label>
						<Textarea
							class="font-mono text-sm"
							id="browserInstallScript"
							name="browserInstallScript"
							rows={2}
							value={data.configuration.browserInstallScript}
						></Textarea>
						<label for="startScript">App Startup Commands</label>
						<Textarea
							class="font-mono text-sm"
							id="startScript"
							name="startScript"
							rows={2}
							value={data.configuration.startScript}
							placeholder="pnpm dev --host 127.0.0.1 --port 5173 --strictPort"
						></Textarea>
						<label for="readyScript">App Readiness Commands</label>
						<Textarea
							class="font-mono text-sm"
							id="readyScript"
							name="readyScript"
							rows={3}
							value={data.configuration.readyScript}
							placeholder="Your command that waits for the app and exits nonzero if it cannot start"
						></Textarea>
						<label for="smokeScript">Browser / Sign-In Smoke Test</label>
						<Textarea
							class="font-mono text-sm"
							id="smokeScript"
							name="smokeScript"
							rows={3}
							value={data.configuration.smokeScript}
							placeholder="Your repository's end-to-end test command"
						></Textarea>
						<p class="field-help">
							Runs after app readiness, or directly after validation when it manages its own server.
						</p>
					</Card.Root>
					<Card.Root class="panel">
						<h2>Environment and Agent Instructions</h2>
						<p class="muted">
							Manage credentials in <a href={resolve('/configuration/secrets')}
								>Secrets & Environment</a
							>. Overrides below are for local database URLs, ports, and fixture values.
						</p>
						<label for="environment">Local Environment Overrides (JSON)</label>
						<Textarea
							class="font-mono text-sm"
							id="environment"
							name="environment"
							rows={7}
							value={JSON.stringify(data.configuration.environment, null, 2)}
						></Textarea>
						<label for="generatedVariables">Generate Fresh Values Per Workspace</label>
						<Input
							id="generatedVariables"
							name="generatedVariables"
							value={data.configuration.generatedVariables.join(', ')}
							placeholder="BETTER_AUTH_SECRET"
						/>
						<p class="field-help">
							Comma-separated variable names. Each receives a random 32-byte hex value, overriding
							its saved mapping.
						</p>
						<label for="instructions">Instructions for Coding Agents</label>
						<Textarea
							class="font-mono text-sm"
							id="instructions"
							name="instructions"
							rows={5}
							value={data.configuration.instructions}
						></Textarea>
						<div class="actions">
							<Button type="submit" disabled={busy} name="intent" value="save">Save Setup</Button
							><Button disabled={busy} type="submit" name="intent" value="test" variant="outline"
								>Save and Test Setup</Button
							>
						</div>
					</Card.Root>
				</form>
			{/key}
			<section aria-labelledby="setup-results">
				<div class="section-heading">
					<h2 id="setup-results">Setup Tests</h2>
					<Button variant="outline" onclick={() => invalidateAll()}>Refresh Results</Button>
				</div>
				{#if !data.tests.length}<p class="muted">
						No tests yet. Configured does not mean tested.
					</p>{/if}
				{#each data.tests as test (test.job_id)}
					<Card.Root class="panel">
						<div class="section-heading">
							<strong
								>{test.status === 'passed'
									? 'Configured Checks Passed'
									: test.status === 'failed'
										? 'Needs Attention'
										: test.status === 'queued'
											? 'Queued'
											: 'Testing'}</strong
							><span class="muted">{new Date(test.created_at).toLocaleString()}</span>
						</div>
						<p class="muted">
							Commit {test.commit.slice(0, 10)} · {test.profile_hash === data.hash
								? 'Current Setup'
								: 'Earlier Setup'}
						</p>
						{#if test.status === 'running' || test.status === 'queued'}<p>{test.stage}</p>{/if}
						{#if test.error}<p role="alert">{test.error}</p>{/if}
						{#each test.checks as check (check.name)}<p class="check">
								<Badge variant={check.status === 'failed' ? 'attention' : 'active'}
									>{check.status === 'passed'
										? 'Passed'
										: check.status === 'failed'
											? 'Failed'
											: 'Running'}</Badge
								>
								{(
									{
										validation: 'Validation',
										'app startup': 'App Startup',
										'app readiness': 'App Readiness',
										'browser/authentication smoke test': 'Browser / Sign-In Smoke Test'
									} as Record<string, string>
								)[check.name] ?? check.name}
							</p>{/each}
						{#if !test.configuration.startScript}<p class="muted">
								App startup: not configured.
							</p>{/if}
						{#if !test.configuration.smokeScript}<p class="muted">
								Browser/sign-in smoke test: not configured.
							</p>{/if}
						{#if test.workspace_id}<a href={resolve(`/logs?attempt=${test.workspace_id}`)}
								>View Setup Logs →</a
							>{/if}
						{#if test.cleanup_error}
							<p role="alert">{test.cleanup_error}</p>
							<form
								method="POST"
								action={resolve(
									`/configuration/repositories?/cleanup&repository=${encodeURIComponent(data.repository)}`
								)}
								use:enhance={submit}
							>
								<input type="hidden" name="id" value={test.job_id} /><Button
									type="submit"
									variant="outline">Retry Cleanup</Button
								>
							</form>
						{:else if test.cleaned_at}<p class="muted">
								Test machine removed. Results and logs retained.
							</p>{:else if test.finished_at && test.workspace_id}<p class="muted">
								Removing test machine…
							</p>{/if}
					</Card.Root>
				{/each}
			</section>
		{:else}<Card.Root class="panel"
				><h2>Choose a Repository</h2>
				<p class="muted">
					Open a repository to configure its commands, local environment, and setup tests.
				</p></Card.Root
			>{/if}
	</div>
</div>

<style>
	.setup-layout {
		display: grid;
		grid-template-columns: 250px minmax(0, 1fr);
		gap: 2rem;
		align-items: start;
	}
	.repository-list {
		display: grid;
		gap: 0.4rem;
		max-height: 70vh;
		overflow: auto;
		margin-top: 1rem;
	}
	.repository-list a {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
		padding: 0.6rem;
		border-radius: 0.5rem;
		text-decoration: none;
	}
	.repository-list a:hover {
		background: var(--muted);
	}
	.repository-list a.chosen {
		background: var(--muted);
		outline: 1px solid var(--border);
	}
	.repository-list a span:first-child {
		overflow-wrap: anywhere;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}
	h2 {
		margin: 0;
	}
	label {
		display: block;
		font-weight: 500;
	}
	.field-help {
		margin-top: -0.6rem;
		font-size: 0.85rem;
		color: var(--muted-foreground);
	}
	.actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.check {
		margin: 0;
	}
	.setup-editor {
		min-width: 0;
	}
	@media (max-width: 800px) {
		.setup-layout {
			grid-template-columns: 1fr;
		}
		.repository-list {
			max-height: 240px;
		}
	}
</style>
