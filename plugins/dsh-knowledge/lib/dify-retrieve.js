/** Call a configured Dify dataset retrieve API and map records into search hits. */

const RETRIEVE_TIMEOUT_MS = 10_000;

function retrieveEndpoint(baseUrl, datasetId) {
    const id = String(datasetId ?? '').trim();
    if (!/^[A-Za-z0-9-]{1,64}$/u.test(id))
        return '';
    let url;
    try {
        url = new URL(String(baseUrl ?? ''));
    }
    catch {
        return '';
    }
    if (url.username || url.password)
        return '';
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return '';
    const path = url.pathname.replace(/\/+$/u, '') || '/';
    if (path !== '/v1')
        return '';
    url.pathname = `/v1/datasets/${id}/retrieve`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

async function discardResponse(response) {
    try {
        await response.body?.cancel();
    }
    catch {
        // The body is unused. Closing it avoids leaving the socket open.
    }
}

export async function retrieveDifyDataset({ baseUrl, datasetId, apiKey, query, topK, signal, knowledgeBaseId }) {
    const url = retrieveEndpoint(baseUrl, datasetId);
    const key = String(apiKey ?? '').trim();
    const text = String(query ?? '').trim().slice(0, 2000);
    if (!url || !key || !text)
        return [];
    const timeout = AbortSignal.timeout(RETRIEVE_TIMEOUT_MS);
    const abort = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({
                query: text,
                retrieval_model: {
                    search_method: 'semantic_search',
                    reranking_enable: false,
                    reranking_mode: null,
                    reranking_model: {
                        reranking_provider_name: '',
                        reranking_model_name: '',
                    },
                    weights: null,
                    top_k: Math.max(1, Math.min(Math.trunc(topK) || 1, 10)),
                    score_threshold_enabled: false,
                    score_threshold: null,
                },
            }),
            redirect: 'manual',
            signal: abort,
        });
    }
    catch {
        return [];
    }
    if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) {
        await discardResponse(response);
        return [];
    }
    let payload;
    try {
        payload = await response.json();
    }
    catch {
        return [];
    }
    return difyRecordsToHits(payload, knowledgeBaseId);
}

export function difyRecordsToHits(payload, knowledgeBaseId) {
    const records = Array.isArray(payload?.records) ? payload.records : [];
    const now = new Date().toISOString();
    const hits = [];
    const seen = new Set();
    for (const record of records) {
        const segment = record?.segment;
        const content = typeof segment?.content === 'string' ? segment.content.trim() : '';
        const segmentId = typeof segment?.id === 'string' ? segment.id.trim() : '';
        if (!content || !segmentId || typeof record?.score !== 'number' || !Number.isFinite(record.score))
            continue;
        const score = record.score;
        const safeId = segmentId.replace(/[^A-Za-z0-9]/gu, '').slice(0, 24);
        if (!safeId || seen.has(safeId))
            continue;
        seen.add(safeId);
        const documentName = typeof segment?.document?.name === 'string' ? segment.document.name.trim() : '';
        const clamped = Math.min(1, Math.max(0, score));
        hits.push({
            entry: {
                id: `difyseg:${safeId}`,
                knowledgeBaseId,
                title: (documentName || 'Dify 片段').slice(0, 200),
                body: content.slice(0, 4000),
                type: 'fact',
                tags: [],
                scope: { kind: 'global' },
                confidence: clamped,
                status: 'active',
                documentState: 'open',
                version: 1,
                createdAt: now,
                updatedAt: now,
            },
            score: clamped,
        });
    }
    return hits;
}
