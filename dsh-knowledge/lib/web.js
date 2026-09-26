import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DOCX_PREVIEW_STYLE } from './docx-preview-page.js';
const DOCX_PREVIEW_STYLE_HASH = createHash('sha256').update(DOCX_PREVIEW_STYLE).digest('base64');
/** 相对 lib/web.js 的静态资源；每次请求从磁盘读取，避免改 web/ 后必须重启宿主。 */
const STATIC_ASSET_SPECS = new Map([
    ...['model-catalog', 'dialogs', 'select-control', 'document-actions', 'document-sync', 'document-sync-ui', 'writeback-workspace', 'writeback-live', 'base-groups', 'knowledge-import'].map(name => [
        `${name}.js`, { path: `../web/${name}.js`, contentType: 'text/javascript; charset=utf-8' },
    ]),
    ['app.js', { path: '../web/app.js', contentType: 'text/javascript; charset=utf-8' }],
    ['api-client.js', { path: '../web/api-client.js', contentType: 'text/javascript; charset=utf-8' }],
    ['change-review.js', { path: '../web/change-review.js', contentType: 'text/javascript; charset=utf-8' }],
    ['host-theme.js', { path: '../web/host-theme.js', contentType: 'text/javascript; charset=utf-8' }],
    ['markdown-preview.js', { path: '../web/markdown-preview.js', contentType: 'text/javascript; charset=utf-8' }],
    ['note-editor.js', { path: '../web/note-editor.js', contentType: 'text/javascript; charset=utf-8' }],
    ['note-history.js', { path: '../web/note-history.js', contentType: 'text/javascript; charset=utf-8' }],
    ['note-excerpt.js', { path: '../web/note-excerpt.js', contentType: 'text/javascript; charset=utf-8' }],
    ['ui-primitives.js', { path: '../web/ui-primitives.js', contentType: 'text/javascript; charset=utf-8' }],
    ['design-tokens.css', { path: '../web/design-tokens.css', contentType: 'text/css; charset=utf-8' }],
    ['styles.css', { path: '../web/styles.css', contentType: 'text/css; charset=utf-8' }],
]);
const INDEX_TEMPLATE = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
export function registerKnowledgeWeb(ctx, webPath, apiPrefix, authMode = 'bearer', embedToken) {
    const webServer = ctx.webServer ?? ctx.get('webServer');
    if (webServer === undefined)
        throw new Error('exposeWeb requires the DSH webServer service');
    return webServer.register({
        kind: 'prefix',
        path: webPath,
        handler: (req, res) => serveWeb(req, res, webPath, apiPrefix, authMode, embedToken),
    });
}
function serveWeb(req, res, webPath, apiPrefix, authMode, embedToken) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', ...securityHeaders() });
        res.end();
        return;
    }
    const pathname = new URL(req.url ?? '/', 'http://knowledge.local').pathname;
    const relative = pathname.slice(webPath.length).replace(/^\/+|\/+$/g, '');
    if (relative.length === 0) {
        const embedded = embedToken !== undefined && hasValidEmbedToken(req.url, embedToken);
        const index = buildIndexHtml(webPath, apiPrefix, authMode, embedded ? 'embedded' : 'standalone');
        sendAsset(res, method, { body: index, contentType: 'text/html; charset=utf-8' }, embedded);
        return;
    }
    const asset = readStaticAsset(relative);
    if (asset === undefined) {
        res.writeHead(404, securityHeaders());
        res.end();
        return;
    }
    sendAsset(res, method, asset);
}
function sendAsset(res, method, asset, embedded = false) {
    res.writeHead(200, {
        ...securityHeaders(embedded),
        'content-type': asset.contentType,
        'content-length': asset.body.byteLength,
        'cache-control': asset.contentType.startsWith('text/html') ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    res.end(method === 'HEAD' ? undefined : asset.body);
}
function securityHeaders(embedded = false) {
    // The editor and workspace effects position their own controls and expose
    // validated host-theme tokens through element.style. Keep stylesheet
    // sources locked to this origin while allowing those style attributes.
    const policy = `default-src 'self'; script-src 'self'; style-src 'self' 'sha256-PlumsSlvJ7vvWzjqibGAYKq92O3y/4JTxWWsWJvyUYA=' 'sha256-${DOCX_PREVIEW_STYLE_HASH}'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; frame-src blob:; connect-src 'self'; font-src 'self'; object-src blob:; base-uri 'none'; form-action 'self'`;
    return {
        'content-security-policy': embedded ? policy : `${policy}; frame-ancestors 'self'`,
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        ...embedded ? {} : { 'x-frame-options': 'SAMEORIGIN' },
        'cross-origin-opener-policy': 'same-origin',
    };
}
function hasValidEmbedToken(rawUrl, expected) {
    const supplied = new URL(rawUrl ?? '/', 'http://knowledge.local').searchParams.get('embed');
    if (supplied === null)
        return false;
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    return suppliedBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(suppliedBytes, expectedBytes);
}
function readStaticAsset(relative) {
    const spec = STATIC_ASSET_SPECS.get(relative);
    if (spec === undefined)
        return undefined;
    return { body: readFileSync(new URL(spec.path, import.meta.url)), contentType: spec.contentType };
}
function currentAssetVersion() {
    const hash = createHash('sha256');
    for (const spec of STATIC_ASSET_SPECS.values()) {
        hash.update(readFileSync(new URL(spec.path, import.meta.url)));
    }
    return hash.digest('hex').slice(0, 12);
}
function buildIndexHtml(webPath, apiPrefix, authMode, embedMode) {
    const version = currentAssetVersion();
    return Buffer.from(INDEX_TEMPLATE
        .replaceAll('__DSH_KNOWLEDGE_API_PREFIX__', escapeHtmlAttribute(apiPrefix))
        .replaceAll('__DSH_KNOWLEDGE_AUTH_MODE__', escapeHtmlAttribute(authMode))
        .replaceAll('__DSH_KNOWLEDGE_WEB_PATH__', escapeHtmlAttribute(webPath))
        .replaceAll('__DSH_KNOWLEDGE_ASSET_VERSION__', version)
        .replaceAll('__DSH_KNOWLEDGE_EMBED_MODE__', embedMode));
}
function escapeHtmlAttribute(value) {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
//# sourceMappingURL=web.js.map
