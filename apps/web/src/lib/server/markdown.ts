import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function renderMarkdown(markdown: string): string {
	return sanitizeHtml(marked.parse(markdown, { async: false, gfm: true }), {
		allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'input'],
		allowedAttributes: {
			...sanitizeHtml.defaults.allowedAttributes,
			img: ['src', 'alt', 'title', 'width', 'height'],
			code: ['class'],
			input: ['type', 'checked', 'disabled']
		},
		transformTags: {
			input: (_tag, attributes) => ({
				tagName: 'input',
				attribs: {
					type: 'checkbox',
					disabled: '',
					...(Object.hasOwn(attributes, 'checked') ? { checked: '' } : {})
				}
			})
		}
	});
}
