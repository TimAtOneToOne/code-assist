<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
</script>

<svelte:head>
	<title>Home · Code Assist</title>
	<meta name="description" content="Your development workspace on Mia." />
</svelte:head>

<div class="eyebrow">YOUR WORKSPACE</div>
<h1>A place to move work forward.</h1>
<p class="intro">From the first question to a reviewed pull request.</p>

<Card.Root class="empty-state" aria-labelledby="empty-title">
	<Card.Content class="flex flex-col items-center">
		<div class="empty-icon" aria-hidden="true">[ ]</div>
		<Card.Title id="empty-title">Ready for the next piece.</Card.Title>
		<Card.Description>
			The app is up. Ticket intake, plans, and agent activity will live here as we build out the
			workflow.
		</Card.Description>
		<Button href={resolve('/configuration')} size="lg" class="gap-6 px-5">
			View configuration <span aria-hidden="true">→</span>
		</Button>
	</Card.Content>
</Card.Root>
<div class="note">
	<span class="note-dot"></span> Foundation only. No tickets or agents are running yet.
</div>
