<script lang="ts">
	import type { PageProps } from './$types';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Configuration · Code Assist</title></svelte:head>
<div class="eyebrow">WORKSPACE SETTINGS</div>
<h1>Configuration</h1>
<p class="intro">A home for connections and workspace preferences.</p>
<Card.Root class="panel">
	<Card.Title>Agent Models</Card.Title>
	<Card.Description>Choose the Codex and Claude models used for new agent steps.</Card.Description>
	<div>
		<Button href={resolve('/configuration/models')} variant="outline">Configure Models →</Button>
	</div>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>Prompt Management</Card.Title>
	<Card.Description>
		Edit global, planning, coding, agent-task, and repository-specific instructions.
	</Card.Description>
	<div>
		<Button href={resolve('/configuration/prompts')} variant="outline">Manage Prompts →</Button>
	</div>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>Ticket Intake</Card.Title>
	<Card.Description
		>Connect Linear, choose the polling interval and configure Teams attention links.</Card.Description
	>
	<div>
		<Button href={resolve('/configuration/intake')} variant="outline">Configure intake →</Button>
	</div>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>Repository Setup</Card.Title>
	<Card.Description
		>Configure installation, local services, validation, and browser checks.</Card.Description
	>
	<div>
		<Button href={resolve('/configuration/repositories')} variant="outline"
			>Configure Repositories →</Button
		>
	</div>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>Secrets & Environment</Card.Title>
	<Card.Description
		>Manage shared keys and map them to repository-specific environment variables.</Card.Description
	>
	<div>
		<Button href={resolve('/configuration/secrets')} variant="outline"
			>Manage secrets & mappings →</Button
		>
	</div>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>Mac mini</Card.Title>
	<Card.Description
		>Choose the folder containing your synced repository clones on Mia.</Card.Description
	>
	<div>
		<Button href={resolve('/configuration/mac-mini')} variant="outline">Configure Mac mini →</Button
		>
	</div>
</Card.Root>
<Card.Root class="panel">
	<Card.Title>AWS Staging</Card.Title>
	<Card.Description>Configure read-only AWS access for Codex and Claude planning.</Card.Description>
	<div>
		<Button href={resolve('/configuration/aws')} variant="outline">Configure AWS Staging →</Button>
	</div>
</Card.Root>
<Card.Root class="panel" aria-labelledby="deployment-title">
	<Card.Header class="panel-heading p-0">
		<Card.Title id="deployment-title">Application</Card.Title>
		<Badge variant="secondary">Foundation</Badge>
	</Card.Header>
	<Card.Content class="p-0">
		<dl>
			<div>
				<dt>Interface</dt>
				<dd>SvelteKit</dd>
			</div>
			<div>
				<dt>Components</dt>
				<dd>shadcn-svelte</dd>
			</div>
			<div>
				<dt>Deployment target</dt>
				<dd>Mia Mac mini</dd>
			</div>
			<div>
				<dt>Network</dt>
				<dd>Tailscale</dd>
			</div>
			<div>
				<dt>Release</dt>
				<dd class="commit">{data.commit ?? 'Local development'}</dd>
			</div>
		</dl>
	</Card.Content>
</Card.Root>
<Card.Root class="panel upcoming">
	<Card.Title>Connections Come Next.</Card.Title>
	<Card.Description
		>Linear, repository selection, and agent settings will be configured here.</Card.Description
	>
	<p class="muted">Shared keys and environment mappings are available above.</p>
</Card.Root>
