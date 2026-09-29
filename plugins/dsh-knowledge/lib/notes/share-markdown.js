import { Renderer, marked } from 'marked';
/** Render public Markdown without accepting embedded HTML or executable URLs. */
export function renderSharedMarkdown(markdown) {
    const headings = [];
    const ids = new Map();
    const renderer = new Renderer();
    renderer.html = ({ text }) => escapeHtml(text);
    renderer.heading = function ({ tokens, depth }) {
        const text = plainText(tokens).trim() || '未命名标题';
        const id = uniqueHeadingId(text, ids);
        headings.push({ id, depth, text });
        return `<h${depth} id="${escapeAttribute(id)}">${this.parser.parseInline(tokens)}<a class="heading-anchor" href="#${escapeAttribute(id)}" aria-label="链接到标题：${escapeAttribute(text)}">#</a></h${depth}>\n`;
    };
    renderer.link = function ({ href, title, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (!safeLink(href))
            return `<span class="unsafe-link">${label}</span>`;
        const external = /^(?:https?|mailto|tel):/iu.test(href);
        return `<a href="${escapeAttribute(href)}"${title ? ` title="${escapeAttribute(title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    };
    renderer.image = ({ href, title, text }) => {
        if (!safeImage(href))
            return `<span class="image-fallback">[图片：${escapeHtml(text || href)}]</span>`;
        return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${title ? ` title="${escapeAttribute(title)}"` : ''} loading="lazy" decoding="async">`;
    };
    renderer.checkbox = ({ checked }) => `<span class="task-box${checked ? ' is-checked' : ''}" role="img" aria-label="${checked ? '已完成' : '未完成'}"></span>`;
    const html = marked.parse(markdown, {
        async: false,
        breaks: false,
        gfm: true,
        renderer,
    });
    return { html, headings };
}
function uniqueHeadingId(text, counts) {
    const base = text
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
        .trim()
        .replace(/[\s_]+/gu, '-')
        .replace(/-+/gu, '-') || 'section';
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
}
function plainText(tokens) {
    return tokens.map(token => {
        if ('tokens' in token && Array.isArray(token.tokens))
            return plainText(token.tokens);
        if ('text' in token && typeof token.text === 'string')
            return token.text;
        return '';
    }).join('');
}
function safeLink(href) {
    const trimmed = href.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../'))
        return true;
    try {
        return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(trimmed).protocol);
    }
    catch {
        return !/^[a-z][a-z\d+.-]*:/iu.test(trimmed);
    }
}
function safeImage(href) {
    const trimmed = href.trim();
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../'))
        return true;
    return /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z\d+/=\s]+$/iu.test(trimmed);
}
function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function escapeAttribute(value) {
    return escapeHtml(value);
}
//# sourceMappingURL=share-markdown.js.map