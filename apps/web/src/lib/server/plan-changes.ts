import { diffArrays, diffWords } from 'diff';
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

type TextPosition = { node: DefaultTreeAdapterTypes.TextNode; start: number };

// Keep inline formatting transparent to the comparison, but separate block text.
function documentText(document: DefaultTreeAdapterTypes.DocumentFragment) {
	let text = '';
	const positions: TextPosition[] = [];
	function visit(node: Node) {
		if (node.nodeName === '#text' && 'value' in node) {
			positions.push({ node, start: text.length });
			text += node.value;
		} else if ('childNodes' in node) {
			const boundary = /^(p|h[1-6]|li|ul|ol|blockquote|pre|table|tr|td|th|div|br|hr)$/.test(
				node.tagName
			);
			if (boundary) text += '\n';
			for (const child of node.childNodes) visit(child);
			if (boundary) text += '\n';
		}
	}
	for (const child of document.childNodes) visit(child);
	return { text, positions };
}

function highlightWords(
	previous: DefaultTreeAdapterTypes.DocumentFragment,
	current: DefaultTreeAdapterTypes.DocumentFragment
) {
	const old = documentText(previous),
		next = documentText(current);
	const ranges: { start: number; end: number }[] = [];
	let offset = 0;
	for (const change of diffWords(old.text, next.text)) {
		if (change.removed) continue;
		if (change.added && change.value.trim())
			ranges.push({ start: offset, end: offset + change.value.length });
		offset += change.value.length;
	}
	for (const { node, start } of next.positions) {
		const parent = node.parentNode;
		if (!parent) continue;
		const replacements: Node[] = [];
		let cursor = 0;
		for (const range of ranges) {
			let from = Math.max(0, range.start - start),
				to = Math.min(node.value.length, range.end - start);
			if (from >= to) continue;
			// Don't paint surrounding whitespace or change the text itself.
			const value = node.value.slice(from, to);
			from += value.length - value.trimStart().length;
			to -= value.length - value.trimEnd().length;
			if (from >= to) continue;
			if (from > cursor) replacements.push({ ...node, value: node.value.slice(cursor, from) });
			const mark = parseFragment('<mark data-plan-change="added"></mark>')
				.childNodes[0] as DefaultTreeAdapterTypes.Element;
			mark.parentNode = parent;
			mark.childNodes.push({ ...node, value: node.value.slice(from, to), parentNode: mark });
			replacements.push(mark);
			cursor = to;
		}
		if (!replacements.length) continue;
		if (cursor < node.value.length) replacements.push({ ...node, value: node.value.slice(cursor) });
		parent.childNodes.splice(parent.childNodes.indexOf(node), 1, ...replacements);
	}
}

// Compare sanitized rendered blocks, so Markdown syntax changes alone don't mark unchanged content.
export function renderPlanChanges(previous: string, current: string) {
	const old = planBlocks(previous),
		next = planBlocks(current);
	const removedHtml: string[] = [];
	let oldIndex = 0,
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
				addedCount += change.count;
			} else oldIndex += change.count;
		}
	}
	highlightWords(old.document, next.document);
	return {
		html: serialize(next.document),
		removedHtml,
		addedCount,
		removedCount: removedHtml.length
	};
}
export type PlanChanges = ReturnType<typeof renderPlanChanges>;
