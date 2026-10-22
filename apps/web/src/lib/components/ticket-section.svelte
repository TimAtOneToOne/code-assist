<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as Card from '#lib/components/ui/card/index.js';
	let {
		title,
		collapsed = false,
		actions,
		children,
		id
	}: {
		title: string;
		collapsed?: boolean;
		actions?: Snippet<[() => void]>;
		children: Snippet;
		id?: string;
	} = $props();
	const uid = $props.id();
	let expanded = $derived(!collapsed);
</script>

<Card.Root class="panel" {id}>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 class="min-w-0">
			<button
				type="button"
				id={`${uid}-title`}
				aria-expanded={expanded}
				aria-controls={`${uid}-body`}
				onclick={() => (expanded = !expanded)}
				class="flex items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
			>
				<ChevronDown
					class={`size-4 shrink-0 text-muted-foreground ${expanded ? '' : '-rotate-90'}`}
					aria-hidden="true"
				/>
				{title}
			</button>
		</h2>
		{#if actions}<div class="flex flex-wrap items-center gap-2">
				{@render actions(() => (expanded = true))}
			</div>{/if}
	</div>
	<div id={`${uid}-body`} hidden={!expanded} class="space-y-5">
		{@render children()}
	</div>
</Card.Root>

<style>
	h2 {
		font-size: 1rem;
		line-height: 1.5;
		font-weight: 500;
		letter-spacing: normal;
	}
</style>
