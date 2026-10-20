import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderPlanChanges } from '../src/lib/server/plan-changes.ts';

test('plan comparison highlights rewritten paragraphs and individual list items while preserving Markdown', () => {
	const previous =
		'# Plan\n\nKeep **storage**.\n\nUse Dialog.\n\n1. Check owner.\n2. Confirm deletion.\n3. Refresh list.';
	const current =
		'# Plan\n\nKeep **storage**.\n\nUse **AlertDialog**.\n\n1. Check owner.\n2. Focus Cancel.\n3. Confirm deletion.\n4. Refresh list.';
	const result = renderPlanChanges(previous, current);
	assert.equal(result.addedCount, 2);
	assert.equal(result.removedCount, 1);
	assert.match(result.html, /<p data-plan-change="added">Use <strong>AlertDialog<\/strong>/);
	assert.match(result.html, /<li data-plan-change="added">Focus Cancel\.<\/li>/);
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
	assert.match(result.html, /<pre data-plan-change="added"><code class="language-ts">next\(\)/);
	assert.match(result.html, /<table data-plan-change="added">/);
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
