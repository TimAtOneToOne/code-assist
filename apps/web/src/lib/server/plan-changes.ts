import { diffArrays } from 'diff';
import { parseFragment, serialize, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5';
import { renderMarkdown } from './markdown.ts';

type Node = DefaultTreeAdapterTypes.ChildNode;
type Block = { node: Node; signature: string; removedHtml: string };

function planBlocks(markdown: string) {
	const document = parseFragment(renderMarkdown(markdown));
	const blocks: Block[] = [];
	for (const node of document.childNodes) {
		if ('tagName' in node && ['ul', 'ol'].includes(node.tagName)) {
			const start = Number(node.attrs.find((a) => a.name === 'start')?.value ?? 1);
			let index = 0;
			for (const item of node.childNodes) {
				if (!('tagName' in item) || item.tagName !== 'li') continue;
				const html = serializeOuter(item);
				blocks.push({
					node: item,
					signature: JSON.stringify([node.tagName, start, html]),
					removedHtml:
						node.tagName === 'ol' ? `<ol start="${start + index}">${html}</ol>` : `<ul>${html}</ul>`
				});
				index++;
			}
		} else if (node.nodeName !== '#comment' && !('value' in node && !node.value.trim())) {
			const html = serializeOuter(node);
			blocks.push({ node, signature: html, removedHtml: html });
		}
	}
	return { document, blocks };
}

// Compare sanitized rendered blocks, so Markdown syntax changes alone don't mark unchanged content.
export function renderPlanChanges(previous: string, current: string) {
	const old = planBlocks(previous),
		next = planBlocks(current);
	const removedHtml: string[] = [];
	let oldIndex = 0,
		newIndex = 0,
		addedCount = 0;
	for (const change of diffArrays(
		old.blocks.map((b) => b.signature),
		next.blocks.map((b) => b.signature)
	)) {
		if (change.removed) {
			for (const block of old.blocks.slice(oldIndex, oldIndex + change.count))
				removedHtml.push(block.removedHtml);
			oldIndex += change.count;
		} else {
			if (change.added) {
				for (const block of next.blocks.slice(newIndex, newIndex + change.count)) {
					const node = block.node;
					if ('attrs' in node) node.attrs.push({ name: 'data-plan-change', value: 'added' });
					else if (node.parentNode) {
						const replacement = parseFragment(
							`<mark data-plan-change="added">${serializeOuter(node)}</mark>`
						).childNodes[0];
						replacement.parentNode = node.parentNode;
						node.parentNode.childNodes.splice(
							node.parentNode.childNodes.indexOf(node),
							1,
							replacement
						);
					}
					addedCount++;
				}
			} else oldIndex += change.count;
			newIndex += change.count;
		}
	}
	return {
		html: serialize(next.document),
		removedHtml,
		addedCount,
		removedCount: removedHtml.length
	};
}
export type PlanChanges = ReturnType<typeof renderPlanChanges>;
