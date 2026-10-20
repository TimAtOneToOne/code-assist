<script lang="ts">
	let { html }: { html: string } = $props();
</script>

<div class="markdown">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- HTML is sanitized by server/markdown.ts; plan-changes.ts adds only generated highlight markers. -->
	{@html html}
</div>

<style>
	.markdown {
		line-height: 1.7;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.markdown :global(:is(h1, h2, h3, h4, h5, h6)) {
		margin: 1.4em 0 0.6em;
		font-weight: 600;
		line-height: 1.35;
		letter-spacing: normal;
	}
	.markdown :global(h1) {
		font-size: 1.5rem;
	}
	.markdown :global(h2) {
		font-size: 1.25rem;
	}
	.markdown :global(h3) {
		font-size: 1.1rem;
	}
	.markdown :global(p) {
		margin: 0.8em 0;
		color: inherit;
	}
	.markdown :global(a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.markdown :global(ul) {
		list-style: disc;
		padding-left: 1.5em;
		margin: 0.8em 0;
	}
	.markdown :global(ol) {
		list-style: decimal;
		padding-left: 1.5em;
		margin: 0.8em 0;
	}
	.markdown :global(li + li) {
		margin-top: 0.25em;
	}
	.markdown :global(code) {
		font-family: monospace;
		background: var(--muted);
		border-radius: 4px;
		padding: 0.15em 0.3em;
	}
	.markdown :global(pre) {
		overflow-x: auto;
		padding: 1em;
		border-radius: 6px;
		background: var(--muted);
		margin: 1em 0;
	}
	.markdown :global(pre code) {
		padding: 0;
	}
	.markdown :global(blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 1em;
		margin: 1em 0;
		color: var(--muted-foreground);
	}
	.markdown :global(table) {
		display: block;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		margin: 1em 0;
	}
	.markdown :global(:is(th, td)) {
		border: 1px solid var(--border);
		padding: 0.5em 0.8em;
		text-align: left;
	}
	.markdown :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: 6px;
	}
	.markdown :global(hr) {
		margin: 1.5em 0;
		border-color: var(--border);
	}
	.markdown :global(input[type='checkbox']) {
		margin-right: 0.4em;
	}
	.markdown :global([data-plan-change='added']) {
		background: #fef08a;
		color: #422006;
		border-radius: 3px;
		box-shadow: -3px 0 0 #eab308;
	}
	.markdown :global([data-plan-change='added'] code) {
		background: transparent;
	}
	.markdown :global(> :first-child) {
		margin-top: 0;
	}
	.markdown :global(> :last-child) {
		margin-bottom: 0;
	}
</style>
