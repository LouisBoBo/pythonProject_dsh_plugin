import { normalizeRemoteKnowledgeUrl } from './remote-url.js';
import { buildSearchQuery } from './search-query.js';
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_SEARCH_URL_BYTES = 6000;
export class RemoteKnowledgeProvider {
    options;
    mode = 'remote';
    baseUrl;
    constructor(options) {
        this.options = options;
        this.baseUrl = normalizeRemoteKnowledgeUrl(options.url);
    }
    async getSettings(signal) {
        return this.request('settings', { signal });
    }
    async updateSettings(patch, signal) {
        return this.request('settings', { method: 'PUT', body: { patch }, signal });
    }
    async listKnowledgeBases(signal) {
        return this.request('knowledge-bases', { signal });
    }
    async getKnowledgeBase(id, signal) {
        try {
            return await this.request(`knowledge-bases/${encodeURIComponent(id)}`, { signal });
        }
        catch (error) {
            if (error instanceof RemoteProviderError && error.status === 404)
                return undefined;
            throw error;
        }
    }
    async createKnowledgeBase(draft, signal) {
        return this.request('knowledge-bases', { method: 'POST', body: { draft }, signal });
    }
    async updateKnowledgeBase(id, draft, signal) {
        return this.request(`knowledge-bases/${encodeURIComponent(id)}`, { method: 'PUT', body: { draft }, signal });
    }
    async patchKnowledgeBase(id, patch, signal) {
        return this.request(`knowledge-bases/${encodeURIComponent(id)}`, { method: 'PATCH', body: { patch }, signal });
    }
    async assignKnowledgeBaseGroup(ids, group, signal) {
        return this.request('knowledge-bases/group', { method: 'POST', body: { ids, group }, signal });
    }
    async archiveKnowledgeBase(id, signal) {
        return this.request(`knowledge-bases/${encodeURIComponent(id)}/archive`, { method: 'POST', signal });
    }
    async restoreKnowledgeBase(id, signal) {
        return this.request(`knowledge-bases/${encodeURIComponent(id)}/restore`, { method: 'POST', signal });
    }
    async deleteKnowledgeBase(id, signal) {
        await this.request(`knowledge-bases/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
    }
    async listDocuments(knowledgeBaseId, query, signal) {
        const params = new URLSearchParams();
        if (knowledgeBaseId !== undefined)
            params.set('knowledgeBaseId', knowledgeBaseId);
        if (query !== undefined && query.trim().length > 0)
            params.set('q', query.trim());
        return this.request(`documents?${params}`, { signal });
    }
    async listDocumentIndex(request, signal) {
        const params = new URLSearchParams({ limit: String(request.limit) });
        for (const id of request.knowledgeBaseIds ?? [])
            params.append('knowledgeBaseId', id);
        if (request.activeKnowledgeBasesOnly)
            params.set('active', '1');
        if (request.query !== undefined && request.query.trim().length > 0)
            params.set('q', request.query.trim());
        if (request.cursor !== undefined)
            params.set('cursor', request.cursor);
        return this.request(`document-index?${params}`, { signal });
    }
    async getDocument(id, signal) {
        try {
            return await this.request(`documents/${encodeURIComponent(id)}`, { signal });
        }
        catch (error) {
            if (error instanceof RemoteProviderError && error.status === 404)
                return undefined;
            throw error;
        }
    }
    async listMounts(targetKind, targetId, signal) {
        const params = new URLSearchParams();
        if (targetKind !== undefined)
            params.set('targetKind', targetKind);
        if (targetId !== undefined)
            params.set('targetId', targetId);
        return this.request(`mounts?${params}`, { signal });
    }
    async upsertMount(draft, signal) {
        return this.request('mounts', { method: 'POST', body: { draft }, signal });
    }
    async applyMountBatch(batch, signal) {
        return this.request('mounts/bulk', { method: 'POST', body: batch, signal });
    }
    async deleteMount(id, signal) {
        await this.request(`mounts/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
    }
    async resolveMounts(sessionId, projectId, signal) {
        const params = new URLSearchParams({ sessionId });
        if (projectId !== undefined)
            params.set('projectId', projectId);
        return this.request(`mounts/resolve?${params}`, { signal });
    }
    async search(request, signal) {
        const params = new URLSearchParams({ q: request.text, limit: String(request.limit) });
        if (request.projectId !== undefined)
            params.set('projectId', request.projectId);
        for (const id of request.knowledgeBaseIds ?? [])
            params.append('knowledgeBaseId', id);
        for (const tag of request.includeTags ?? [])
            params.append('includeTag', tag);
        for (const tag of request.excludeTags ?? [])
            params.append('excludeTag', tag);
        for (const type of request.types ?? [])
            params.append('type', type);
        const path = `search?${params}`;
        if (Buffer.byteLength(new URL(path, this.baseUrl).href) <= MAX_SEARCH_URL_BYTES) {
            return this.request(path, { signal });
        }
        try {
            return await this.request('search', { method: 'POST', body: request, signal });
        }
        catch (error) {
            // Old servers expose GET only. Never retry auth, validation, network or
            // server failures, and never remove the caller's scope/tag filters.
            if (!(error instanceof RemoteProviderError) || ![404, 405, 501].includes(error.status))
                throw error;
            const query = buildSearchQuery(request.text);
            if (!query)
                throw new RemoteProviderError('knowledge server does not support long searches; upgrade the server or use a shorter query', error.status);
            params.set('q', query);
            const fallback = `search?${params}`;
            if (Buffer.byteLength(new URL(fallback, this.baseUrl).href) > MAX_SEARCH_URL_BYTES) {
                throw new RemoteProviderError('knowledge search filters exceed the legacy URL limit; upgrade the knowledge server', error.status);
            }
            return this.request(fallback, { signal });
        }
    }
    async stats(signal) {
        return this.request('stats', { signal });
    }
    async list(request, signal) {
        const params = new URLSearchParams({ limit: String(request.limit) });
        if (request.status !== undefined)
            params.set('status', request.status);
        if (request.projectId !== undefined)
            params.set('projectId', request.projectId);
        if (request.knowledgeBaseId !== undefined)
            params.set('knowledgeBaseId', request.knowledgeBaseId);
        if (request.type !== undefined)
            params.set('type', request.type);
        if (request.cursor !== undefined)
            params.set('cursor', request.cursor);
        return this.request(`entries?${params}`, { signal });
    }
    async get(id, signal) {
        try {
            return await this.request(`entries/${encodeURIComponent(id)}`, { signal });
        }
        catch (error) {
            if (error instanceof RemoteProviderError && error.status === 404)
                return undefined;
            throw error;
        }
    }
    async versions(id, signal) {
        return this.request(`entries/${encodeURIComponent(id)}/versions`, { signal });
    }
    async create(draft, signal) {
        return this.request('entries', { method: 'POST', body: { draft }, signal });
    }
    async update(id, draft, signal, expectedVersion) {
        return this.request(`entries/${encodeURIComponent(id)}`, { method: 'PUT', body: { draft, expectedVersion }, signal });
    }
    async finalize(id, state, note, signal) {
        return this.request(`documents/${encodeURIComponent(id)}/finalize`, {
            method: 'POST', body: { state, ...note === undefined ? {} : { note } }, signal,
        });
    }
    async reopen(id, signal) {
        return this.request(`documents/${encodeURIComponent(id)}/reopen`, { method: 'POST', signal });
    }
    async moveDocument(id, knowledgeBaseId, signal) {
        return this.request(`documents/${encodeURIComponent(id)}/move`, {
            method: 'POST', body: { knowledgeBaseId }, signal,
        });
    }
    async archive(id, signal) {
        return this.request(`entries/${encodeURIComponent(id)}/archive`, { method: 'POST', signal });
    }
    async delete(id, signal) {
        await this.request(`entries/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
    }
    async listNotes(request = {}, signal) {
        const params = new URLSearchParams({ limit: String(request.limit ?? 200) });
        const query = request.query?.trim();
        if (query)
            params.set('q', query);
        else if (request.parentId !== undefined && request.parentId !== null)
            params.set('parentId', request.parentId);
        else if (request.parentId === null)
            params.set('parentId', '');
        return this.request(`notes?${params}`, { signal });
    }
    async getNote(id, signal) {
        try {
            return await this.request(`notes/${encodeURIComponent(id)}`, { signal });
        }
        catch (error) {
            if (error instanceof RemoteProviderError && error.status === 404)
                return undefined;
            throw error;
        }
    }
    async readNote(id, signal) {
        const node = await this.getNote(id, signal);
        if (node === undefined)
            throw new RemoteProviderError(`note node "${id}" was not found`, 404);
        const content = await this.requestBytes(node.editable ? `notes/${encodeURIComponent(id)}/versions/${node.version}/content` : `notes/${encodeURIComponent(id)}/content`, { signal });
        return { node, content };
    }
    async listNoteVersions(id, limit = 100, signal) {
        const params = new URLSearchParams({ limit: String(limit) });
        return this.request(`notes/${encodeURIComponent(id)}/versions?${params}`, { signal });
    }
    async readNoteVersion(id, version, signal) {
        const [node, versions, content] = await Promise.all([
            this.getNote(id, signal),
            this.listNoteVersions(id, 200, signal),
            this.requestBytes(`notes/${encodeURIComponent(id)}/versions/${version}/content`, { signal }),
        ]);
        if (node === undefined)
            throw new RemoteProviderError(`note node "${id}" was not found`, 404);
        const snapshot = versions.find(item => item.version === version);
        if (snapshot === undefined)
            throw new RemoteProviderError(`note version "${id}@${version}" was not found`, 404);
        return { node, version: snapshot, content };
    }
    async restoreNoteVersion(id, version, expectedVersion, signal) {
        return this.request(`notes/${encodeURIComponent(id)}/versions/${version}/restore`, {
            method: 'POST', body: { expectedVersion }, signal,
        });
    }
    async createNoteFolder(name, parentId = null, signal) {
        return this.request('notes/folders', { method: 'POST', body: { name, parentId }, signal });
    }
    async createNoteDocument(name, parentId = null, content = '', signal) {
        return this.request('notes/documents', { method: 'POST', body: { name, parentId, content }, signal });
    }
    async updateNoteContent(id, content, signal, expectedVersion) {
        const query = expectedVersion === undefined ? '' : `?expectedVersion=${expectedVersion}`;
        const response = await this.requestBytes(`notes/${encodeURIComponent(id)}/content${query}`, {
            method: 'PUT', binaryBody: content, signal, accept: 'application/json',
        });
        return safeJson(new TextDecoder().decode(response));
    }
    async renameNote(id, name, signal) {
        return this.request(`notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name }, signal });
    }
    async moveNote(id, parentId, signal) {
        return this.request(`notes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { parentId }, signal });
    }
    async deleteNote(id, signal) {
        await this.request(`notes/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
    }
    async searchNotes(query, limit, signal) {
        const params = new URLSearchParams({ q: query, limit: String(limit) });
        return this.request(`notes?${params}`, { signal });
    }
    async listKnowledgeNoteReferences(knowledgeId, signal) {
        return this.request(`entries/${encodeURIComponent(knowledgeId)}/note-references`, { signal });
    }
    async addKnowledgeNoteReference(knowledgeId, noteId, source, sourceSessionId, signal) {
        return this.request(`entries/${encodeURIComponent(knowledgeId)}/note-references`, {
            method: 'POST', body: { noteId, source, sourceSessionId }, signal,
        });
    }
    async deleteKnowledgeNoteReference(knowledgeId, noteId, signal) {
        await this.request(`entries/${encodeURIComponent(knowledgeId)}/note-references/${encodeURIComponent(noteId)}`, {
            method: 'DELETE', signal,
        });
    }
    async propose(proposal, sourceKey, signal) {
        return this.request('candidates', { method: 'POST', body: { proposal, sourceKey }, signal });
    }
    async writeDirect(proposal, sourceKey, signal) {
        return this.request('candidates/direct', { method: 'POST', body: { proposal, sourceKey }, signal });
    }
    async listCandidates(status, limit, signal) {
        return this.request(`candidates?${new URLSearchParams({ status, limit: String(limit) })}`, { signal });
    }
    async review(id, decision, signal) {
        return this.request(`candidates/${encodeURIComponent(id)}/review`, { method: 'POST', body: decision, signal });
    }
    async approvePendingBatch(limit, excludeIds = [], signal) {
        return this.request('candidates/bulk-review', {
            method: 'POST', body: { limit, excludeIds }, signal,
        });
    }
    async claimExtraction(sourceKey, signal) {
        const result = await this.request(`extraction-jobs/${encodeURIComponent(sourceKey)}/claim`, { method: 'POST', signal });
        return result.claimed;
    }
    async completeExtraction(sourceKey, completion, signal) {
        const candidateCount = typeof completion === 'number' ? completion : completion.candidateCount;
        await this.request(`extraction-jobs/${encodeURIComponent(sourceKey)}/complete`, {
            method: 'POST', body: { candidateCount, ...typeof completion === 'number' ? {} : { completion } }, signal,
        });
    }
    async failExtraction(sourceKey, error, signal) {
        await this.request(`extraction-jobs/${encodeURIComponent(sourceKey)}/fail`, { method: 'POST', body: { error }, signal });
    }
    async resetExtraction(sourceKey, signal) {
        await this.request(`extraction-jobs/${encodeURIComponent(sourceKey)}/reset`, { method: 'POST', signal });
    }
    async extractionJob(sourceKey, signal) {
        try {
            return await this.request(`extraction-jobs/${encodeURIComponent(sourceKey)}`, { signal });
        }
        catch (error) {
            if (error instanceof RemoteProviderError && error.status === 404)
                return undefined;
            throw error;
        }
    }
    async writebackProtocol(signal) {
        try {
            return await this.request('writeback-protocol', { signal });
        }
        catch (error) {
            if (error instanceof RemoteProviderError && error.status === 404)
                return { idempotentDirectWrites: false };
            throw error;
        }
    }
    async close() { }
    async request(path, options = {}) {
        const response = await this.fetchResponse(path, options);
        const text = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
        if (!response.ok) {
            let payload;
            try {
                payload = text.length === 0 ? undefined : JSON.parse(text);
            }
            catch { /* Proxy errors may be HTML or plain text. */ }
            throw remoteResponseError(path, response.status, payload, text);
        }
        const payload = text.length === 0 ? undefined : safeJson(text);
        return payload;
    }
    async requestBytes(path, options = {}) {
        const response = await this.fetchResponse(path, { ...options, accept: options.accept ?? 'application/octet-stream' });
        if (!response.ok) {
            const text = await readBoundedResponse(response, MAX_RESPONSE_BYTES);
            let payload;
            try {
                payload = text.length === 0 ? undefined : safeJson(text);
            }
            catch {
                payload = undefined;
            }
            throw remoteResponseError(path, response.status, payload, text);
        }
        return readBoundedBytes(response, MAX_NOTE_RESPONSE_BYTES);
    }
    async fetchResponse(path, options) {
        if (options.body !== undefined && options.binaryBody !== undefined)
            throw new Error('remote request cannot contain both JSON and binary bodies');
        const timeout = AbortSignal.timeout(this.options.timeoutMs);
        const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
        try {
            return await fetch(new URL(path, this.baseUrl), {
                method: options.method ?? 'GET',
                headers: {
                    accept: options.accept ?? 'application/json',
                    authorization: `Bearer ${this.options.token}`,
                    ...options.body === undefined ? {} : { 'content-type': 'application/json' },
                    ...options.binaryBody === undefined ? {} : { 'content-type': 'application/octet-stream' },
                },
                ...options.body !== undefined
                    ? { body: JSON.stringify(options.body) }
                    : options.binaryBody !== undefined ? { body: Buffer.from(options.binaryBody) } : {},
                signal,
            });
        }
        catch (error) {
            throw new RemoteProviderError(`knowledge server request failed: ${error instanceof Error ? error.message : String(error)}`, 0);
        }
    }
}
async function readBoundedBytes(response, maximumBytes) {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > maximumBytes) {
        await response.body?.cancel().catch(() => { });
        throw new RemoteProviderError('knowledge server response is too large', 502);
    }
    if (response.body === null)
        return new Uint8Array();
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            size += chunk.value.byteLength;
            if (size > maximumBytes) {
                await reader.cancel().catch(() => { });
                throw new RemoteProviderError('knowledge server response is too large', 502);
            }
            chunks.push(chunk.value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}
async function readBoundedResponse(response, maximumBytes) {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > maximumBytes) {
        await response.body?.cancel().catch(() => { });
        throw new RemoteProviderError('knowledge server response is too large', 502);
    }
    if (response.body === null)
        return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            size += chunk.value.byteLength;
            if (size > maximumBytes) {
                await reader.cancel().catch(() => { });
                throw new RemoteProviderError('knowledge server response is too large', 502);
            }
            text += decoder.decode(chunk.value, { stream: true });
        }
        return text + decoder.decode();
    }
    finally {
        reader.releaseLock();
    }
}
export class RemoteProviderError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = 'RemoteProviderError';
    }
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        throw new RemoteProviderError('knowledge server returned invalid JSON', 502);
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function remoteErrorDetail(payload, text) {
    if (isRecord(payload)) {
        if (typeof payload.error === 'string')
            return payload.error;
        if (isRecord(payload.error) && typeof payload.error.message === 'string')
            return payload.error.message;
        if (typeof payload.message === 'string')
            return payload.message;
    }
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length === 0 ? undefined : compact.slice(0, 500);
}
function remoteResponseError(path, status, payload, text) {
    // Query strings can contain complete conversations, paths or share tokens.
    // Search intermediaries may also echo the URL in their error body.
    const endpoint = path.split('?')[0] ?? path;
    const detail = endpoint === 'search' ? undefined : remoteErrorDetail(payload, text);
    const hint = endpoint === 'search' && [400, 414, 431].includes(status)
        ? '; search request rejected (check query size and server/proxy limits)'
        : '';
    const message = detail === undefined
        ? `knowledge server returned HTTP ${status} for ${endpoint}${hint}`
        : `knowledge server rejected ${endpoint}: ${detail}`;
    return new RemoteProviderError(message, status);
}
//# sourceMappingURL=remote-provider.js.map