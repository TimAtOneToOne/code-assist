<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import { Button } from '#lib/components/ui/button/index.js';

	function jump(to: 'top' | 'bottom') {
		window.scrollTo({ top: to === 'top' ? 0 : document.documentElement.scrollHeight });
	}
</script>

<div
	role="group"
	aria-label="Page navigation"
	class="fixed right-4 bottom-4 z-40 flex flex-col gap-1 rounded-xl border bg-background p-1 shadow-md"
>
	<Button
		variant="ghost"
		size="icon"
		class="size-11"
		aria-label="Jump to the top"
		title="Jump to the top"
		onclick={() => jump('top')}><ArrowUp aria-hidden="true" /></Button
	>
	<Button
		variant="ghost"
		size="icon"
		class="size-11"
		aria-label="Jump to the bottom"
		title="Jump to the bottom"
		onclick={() => jump('bottom')}><ArrowDown aria-hidden="true" /></Button
	>
</div>
