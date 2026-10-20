import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from '../src/lib/server/markdown.ts';

test('ticket Markdown renders headings, links, lists, code, tables and tasks', () => {
	const html = renderMarkdown(
		'## Description\n\nA **bold** change in `connect`.\n\n[ONE-4801](https://linear.app/one/issue/ONE-4801)\n\n- First\n- Second\n\n```ts\nconst x = "<safe>";\n```\n\n| Repo | Role |\n| --- | --- |\n| connect | API |\n\n- [x] Reviewed\n\n![Diagram](https://example.com/diagram.png)'
	);
	for (const expected of [
		'<h2>Description</h2>',
		'<strong>bold</strong>',
		'<code>connect</code>',
		'<a href="https://linear.app/one/issue/ONE-4801">ONE-4801</a>',
		'<li>First</li>',
		'<pre><code class="language-ts">',
		'&lt;safe&gt;',
		'<table>',
		'type="checkbox"',
		'checked',
		'disabled',
		'<img src="https://example.com/diagram.png"'
	])
		assert(html.includes(expected), expected);
});

test('ticket HTML cannot execute scripts, inject handlers or activate unsafe links', () => {
	const html = renderMarkdown(
		'<script>alert(1)</script><img src="x" onerror="alert(2)">\n\n[unsafe](javascript:alert%281%29)\n\n<a href="javascript:alert(3)" onclick="alert(4)">link</a><iframe src="https://evil.invalid"></iframe><input type="text" value="injected">'
	);
	for (const forbidden of [
		'<script',
		'onerror',
		'onclick',
		'javascript:',
		'<iframe',
		'type="text"',
		'injected'
	])
		assert(!html.includes(forbidden), forbidden);
	assert(html.includes('type="checkbox" disabled'));
});
