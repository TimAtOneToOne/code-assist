<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import './app.css';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" />
</svelte:head>

<div class="shell">
	<aside>
		<a class="brand" href={resolve('/')}><span class="brand-mark">c/</span> Code Assist</a>
		<div class="nav-label">WORKSPACE</div>
		<nav aria-label="Main navigation">
			<a href={resolve('/')} aria-current={page.url.pathname === '/' ? 'page' : undefined}>Home</a>

			<a
				href={resolve('/configuration')}
				aria-current={page.url.pathname === '/configuration' ? 'page' : undefined}>Configuration</a
			>
		</nav>
		<div class="host"><span class="dot"></span> Mia Mac mini <small>Private workspace</small></div>
	</aside>
	<div class="workspace">
		<header>
			<span>Development workspace</span>
			<span class="release">{data.commit ? data.commit.slice(0, 7) : 'Local development'}</span>
		</header>
		<main>{@render children()}</main>
		<footer>Code Assist <span>Built for work, one ticket at a time.</span></footer>
	</div>
</div>
