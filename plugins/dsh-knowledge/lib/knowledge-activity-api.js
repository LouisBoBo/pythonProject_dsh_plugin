const API_PREFIX = '/knowledge-control/v1/activity';
const CLIENT_HEADER = 'conversation-web';
export async function loadMountedKnowledge(sessionId, projectId, signal) {
    const params = new URLSearchParams({ sessionId });
    if (projectId !== undefined)
        params.set('projectId', projectId);
    const value = await request(`mounts?${params}`, signal);
    if (!Array.isArray(value))
        throw new Error('知识库挂载接口返回了无效数据。');
    return value.filter(isResolvedMount);
}
export async function loadKnowledgeDocumentIndex(input) {
    const params = new URLSearchParams({ sessionId: input.sessionId, limit: '60' });
    if (input.projectId !== undefined)
        params.set('projectId', input.projectId);
    for (const id of input.knowledgeBaseIds)
        params.append('knowledgeBaseId', id);
    if (input.query?.trim())
        params.set('q', input.query.trim());
    if (input.cursor !== undefined)
        params.set('cursor', input.cursor);
    const value = await request(`documents?${params}`, input.signal);
    if (!isDocumentIndex(value))
        throw new Error('知识文档目录返回了无效数据。');
    return value;
}
export async function loadNoteIndex(input) {
    const params = new URLSearchParams({ sessionId: input.sessionId, limit: '200' });
    if (input.projectId !== undefined)
        params.set('projectId', input.projectId);
    if (input.query?.trim())
        params.set('q', input.query.trim());
    else if (input.parentId !== undefined && input.parentId !== null)
        params.set('parentId', input.parentId);
    const value = await request(`notes?${params}`, input.signal);
    if (!Array.isArray(value) || !value.every(isNoteNode))
        throw new Error('笔记目录返回了无效数据。');
    return value;
}
export async function loadNoteContent(input) {
    const params = new URLSearchParams({ sessionId: input.sessionId });
    if (input.projectId !== undefined)
        params.set('projectId', input.projectId);
    const value = await request(`notes/${encodeURIComponent(input.id)}/content?${params}`, input.signal);
    if (!isRecord(value) || !isNoteNode(value.node) || typeof value.content !== 'string') {
        throw new Error('笔记正文接口返回了无效数据。');
    }
    return value;
}
export async function loadKnowledgeDocument(input) {
    const params = new URLSearchParams({ sessionId: input.sessionId });
    if (input.projectId !== undefined)
        params.set('projectId', input.projectId);
    const value = await request(`documents/${encodeURIComponent(input.id)}?${params}`, input.signal);
    if (!isDocument(value))
        throw new Error('知识文档接口返回了无效数据。');
    return value;
}
async function request(path, signal) {
    const response = await fetch(`${API_PREFIX}/${path}`, {
        headers: { accept: 'application/json', 'x-dsh-knowledge-client': CLIENT_HEADER },
        ...signal === undefined ? {} : { signal },
    });
    const body = await response.json().catch(() => undefined);
    if (!response.ok) {
        const message = isRecord(body) && typeof body.error === 'string'
            ? body.error
            : `知识库接口返回 HTTP ${response.status}`;
        throw new Error(message);
    }
    return body;
}
function isResolvedMount(value) {
    return isRecord(value)
        && typeof value.knowledgeBaseId === 'string'
        && typeof value.enabled === 'boolean'
        && isRecord(value.base)
        && typeof value.base.id === 'string'
        && typeof value.base.name === 'string';
}
function isDocumentIndex(value) {
    return isRecord(value)
        && Array.isArray(value.items)
        && value.items.every(isDocumentSummary)
        && Number.isInteger(value.total)
        && (value.nextCursor === undefined || typeof value.nextCursor === 'string');
}
function isDocumentSummary(value) {
    return isRecord(value)
        && typeof value.id === 'string'
        && typeof value.knowledgeBaseId === 'string'
        && typeof value.relPath === 'string'
        && typeof value.title === 'string'
        && typeof value.updatedAt === 'string'
        && (value.documentState === 'open' || value.documentState === 'resolved' || value.documentState === 'complete');
}
function isDocument(value) {
    return isDocumentSummary(value) && isRecord(value) && typeof value.content === 'string';
}
function isNoteNode(value) {
    return isRecord(value)
        && typeof value.id === 'string'
        && (value.parentId === null || typeof value.parentId === 'string')
        && (value.kind === 'folder' || value.kind === 'document' || value.kind === 'file')
        && typeof value.name === 'string'
        && (value.mediaType === null || typeof value.mediaType === 'string')
        && typeof value.editable === 'boolean'
        && typeof value.size === 'number'
        && typeof value.version === 'number'
        && typeof value.updatedAt === 'string';
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=knowledge-activity-api.js.map