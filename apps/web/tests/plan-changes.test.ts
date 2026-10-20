import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../src/lib/server/markdown.ts';
import { parseFragment, serialize } from 'parse5';
import { renderPlanChanges } from '../src/lib/server/plan-changes.ts';

test('plan comparison highlights changed words and new list items while preserving Markdown', () => {
	const previous =
		'# Plan\n\nKeep **storage**.\n\nUse Dialog.\n\n1. Check owner.\n2. Confirm deletion.\n3. Refresh list.';
	const current =
		'# Plan\n\nKeep **storage**.\n\nUse **AlertDialog**.\n\n1. Check owner.\n2. Focus Cancel.\n3. Confirm deletion.\n4. Refresh list.';
	const result = renderPlanChanges(previous, current);
	assert.equal(result.addedCount, 2);
	assert.equal(result.removedCount, 1);
	assert.match(
		result.html,
		/<p>Use <strong><mark data-plan-change="added">AlertDialog<\/mark><\/strong>\.<\/p>/
	);
	assert.match(result.html, /<li><mark data-plan-change="added">Focus Cancel\.<\/mark><\/li>/);
	assert.match(result.html, /<li>Check owner\.<\/li>/);
	assert.match(result.html, /<li>Confirm deletion\.<\/li>/);
	assert.match(result.html, /<p>Keep <strong>storage<\/strong>\.<\/p>/);
	assert.deepEqual(result.removedHtml, ['<p>Use Dialog.</p>']);
});
test('deletions remain visible, including replaced code/tables and original ordered list numbering', () => {
	const previous =
		'3. Keep this.\n4. Remove this.\n\n```ts\nold();\n```\n\n| Mode |\n| --- |\n| old |';
	const current = '3. Keep this.\n\n```ts\nnext();\n```\n\n| Mode |\n| --- |\n| new |';
	const result = renderPlanChanges(previous, current);
	assert.equal(result.addedCount, 2);
	assert.equal(result.removedCount, 3);
	assert.match(result.removedHtml[0], /<ol start="4"><li>Remove this\.<\/li><\/ol>/);
	assert.match(result.removedHtml[1], /old\(\)/);
	assert.match(result.removedHtml[2], /<td>old<\/td>/);
	assert.match(
		result.html,
		/<pre><code class="language-ts"><mark data-plan-change="added">next<\/mark>\(\)/
	);
	assert.match(result.html, /<td><mark data-plan-change="added">new<\/mark><\/td>/);
	const deletion = renderPlanChanges('Keep.\n\nRemove.', 'Keep.');
	assert.equal(deletion.addedCount, 0);
	assert.equal(deletion.removedCount, 1);
	assert(!deletion.html.includes('data-plan-change'));
});
test('unchanged rendered content and duplicate paragraphs are matched in sequence', () => {
	const same = renderPlanChanges(
		'## Title\n\n**Same**\n\n- Keep',
		'## Title\n\n__Same__\n\n* Keep'
	);
	assert.equal(same.addedCount, 0);
	assert.equal(same.removedCount, 0);
	const repeated = renderPlanChanges(
		'Repeat.\n\nMiddle.\n\nRepeat.',
		'Repeat.\n\nChanged.\n\nRepeat.'
	);
	assert.equal(repeated.addedCount, 1);
	assert.equal(repeated.removedCount, 1);
	assert.equal((repeated.html.match(/<p>Repeat\.<\/p>/g) ?? []).length, 2);
});
test('both old and new content are sanitized before diff markers are added', () => {
	const result = renderPlanChanges(
		'Old <img src="x" onerror="alert(1)">\n\n[bad](javascript:alert%281%29)',
		'New <script>alert(2)</script>\n\n<img src="y" onload="alert(3)">'
	);
	for (const html of [result.html, ...result.removedHtml])
		for (const forbidden of ['<script', 'onerror', 'onload', 'javascript:'])
			assert(!html.includes(forbidden), forbidden);
	const forged = renderPlanChanges(
		'<p data-plan-change="added">Same.</p>',
		'<p data-plan-change="added">Same.</p>'
	);
	assert.equal(forged.addedCount, 0);
	assert(!forged.html.includes('data-plan-change'));
});

test('word highlights span inline formatting without painting unchanged context', () => {
	const previous =
		'# Plan v2 — Delete threads\n\nTim requires a **shadcn AlertDialog** containing the thread title, buttons labeled **Cancel** and **Delete conversation**, initial focus on Cancel, and no request before confirmation.\n\nKeep this paragraph.';
	const current =
		'# Plan v3 — Delete threads\n\nTim requires a **shadcn AlertDialog** showing the thread title, buttons labeled **Cancel** and **Delete conversation**, initial focus on Cancel, and no request until confirmation.\n\nKeep this paragraph.';
	const result = renderPlanChanges(previous, current);
	assert.deepEqual(
		[...result.html.matchAll(/<mark data-plan-change="added">(.*?)<\/mark>/gs)].map((m) => m[1]),
		['v3', 'showing', 'until']
	);
	assert.equal(
		result.html.replace(/<mark data-plan-change="added">|<\/mark>/g, ''),
		serialize(parseFragment(renderMarkdown(current)))
	);
});

test('marking preserves exact text, escaping, links, nested lists and line breaks', () => {
	const previous =
		'- Keep **safe** text.\n  - Read [old docs](https://example.com/docs).\n\nUse \u0060a < b\u0060. Café.';
	const current =
		'- Keep **safe** text.\n  - Read [new docs](https://example.com/docs).\n\nUse \u0060a < c\u0060. Café ☕.\n\n> New **bold phrase** with more text.\n\nLine one.  \nLine two.';
	const result = renderPlanChanges(previous, current);
	assert.equal(
		result.html.replace(/<mark data-plan-change="added">|<\/mark>/g, ''),
		serialize(parseFragment(renderMarkdown(current)))
	);
	assert.match(
		result.html,
		/<a href="https:\/\/example.com\/docs"><mark data-plan-change="added">new<\/mark> docs<\/a>/
	);
	assert(!result.html.includes('<li data-plan-change'));
});
