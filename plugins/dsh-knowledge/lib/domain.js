import { createHash, randomUUID } from 'node:crypto';
export const KNOWLEDGE_TYPES = ['preference', 'fact', 'decision', 'procedure', 'lesson'];
export const DEFAULT_KNOWLEDGE_BASE_ID = 'default';
export const KNOWLEDGE_DOCUMENT_STATES = ['open', 'resolved', 'complete'];
export const TOKEN_PERMISSIONS = ['read', 'propose', 'write', 'admin'];
const TYPE_SET = new Set(KNOWLEDGE_TYPES);
export function newId() {
    return randomUUID();
}
export function nowIso() {
    return new Date().toISOString();
}
export function normalizeTags(tags) {
    return [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))]
        .sort()
        .slice(0, 32);
}
export function normalizeDraft(input) {
    const knowledgeBaseId = input.knowledgeBaseId?.trim() || DEFAULT_KNOWLEDGE_BASE_ID;
    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length === 0 || title.length > 200)
        throw new Error('knowledge title must contain 1-200 characters');
    if (body.length === 0 || body.length > 50_000)
        throw new Error('knowledge body must contain 1-50000 characters');
    if (!TYPE_SET.has(input.type))
        throw new Error(`unsupported knowledge type "${String(input.type)}"`);
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new Error('knowledge confidence must be between 0 and 1');
    }
    if (input.scope.kind === 'project' && input.scope.id.trim().length === 0) {
        throw new Error('project scope requires a non-empty id');
    }
    if (input.source?.evidence !== undefined
        && input.source.evidence !== 'explicit'
        && input.source.evidence !== 'verified'
        && input.source.evidence !== 'inferred') {
        throw new Error('knowledge source evidence is unsupported');
    }
    return {
        knowledgeBaseId,
        title,
        body,
        type: input.type,
        tags: normalizeTags(input.tags),
        scope: input.scope.kind === 'global'
            ? { kind: 'global' }
            : { kind: 'project', id: input.scope.id.trim() },
        confidence: input.confidence,
        ...input.source === undefined ? {} : { source: { ...input.source } },
    };
}
export function contentHash(draft) {
    const normalized = normalizeDraft(draft);
    return createHash('sha256').update(JSON.stringify({
        knowledgeBaseId: normalized.knowledgeBaseId,
        title: normalized.title.toLowerCase(),
        body: normalized.body.toLowerCase(),
        type: normalized.type,
        tags: normalized.tags,
        scope: normalized.scope,
    })).digest('hex');
}
export function normalizeKnowledgeBaseGroup(value) {
    if (value == null)
        return '';
    if (typeof value !== 'string')
        throw new Error('knowledge base group must be a string');
    const group = value.trim();
    if (group.length > 64 || /[\u0000-\u001f\u007f]/u.test(group))
        throw new Error('knowledge base group must contain at most 64 characters without control characters');
    return group;
}
export function normalizeKnowledgeBaseDraft(input) {
    const group = normalizeKnowledgeBaseGroup(input.group);
    const name = input.name.trim();
    const description = input.description.trim();
    const extractionInstructions = input.extractionInstructions.trim();
    const writebackPolicy = input.writebackPolicy ?? 'conservative';
    if (writebackPolicy !== 'conservative' && writebackPolicy !== 'proactive') {
        throw new Error('knowledge base writeback policy must be conservative or proactive');
    }
    if (name.length === 0 || name.length > 100)
        throw new Error('knowledge base name must contain 1-100 characters');
    if (description.length > 2000)
        throw new Error('knowledge base description must contain at most 2000 characters');
    if (extractionInstructions.length > 4000)
        throw new Error('knowledge base extraction instructions must contain at most 4000 characters');
    const writebackProvider = input.writebackProvider?.trim() || undefined;
    const writebackModel = input.writebackModel?.trim() || undefined;
    if ((writebackProvider === undefined) !== (writebackModel === undefined)) {
        throw new Error('knowledge base writebackProvider and writebackModel must be configured together');
    }
    if (writebackProvider !== undefined && writebackProvider.length > 100) {
        throw new Error('knowledge base writebackProvider must contain at most 100 characters');
    }
    if (writebackModel !== undefined && writebackModel.length > 200) {
        throw new Error('knowledge base writebackModel must contain at most 200 characters');
    }
    return {
        name,
        ...(group ? { group } : {}),
        description,
        defaultTags: normalizeTags(input.defaultTags),
        extractionInstructions,
        writebackPolicy,
        ...writebackProvider === undefined || writebackModel === undefined
            ? {}
            : { writebackProvider, writebackModel },
    };
}
export function normalizeKnowledgeMountDraft(input) {
    const targetId = input.targetId.trim();
    const knowledgeBaseId = input.knowledgeBaseId.trim();
    if (targetId.length === 0)
        throw new Error('knowledge mount targetId must not be empty');
    if (knowledgeBaseId.length === 0)
        throw new Error('knowledge mount knowledgeBaseId must not be empty');
    if (input.targetKind !== 'project' && input.targetKind !== 'session')
        throw new Error('unsupported knowledge mount target kind');
    if (input.writeMode !== 'none' && input.writeMode !== 'audit' && input.writeMode !== 'direct') {
        throw new Error('unsupported knowledge write mode');
    }
    const extractionInstructions = input.extractionInstructions.trim();
    if (extractionInstructions.length > 4000)
        throw new Error('mount extraction instructions must contain at most 4000 characters');
    const includeTags = normalizeTags(input.includeTags);
    const excludeTags = normalizeTags(input.excludeTags);
    if (includeTags.some(tag => excludeTags.includes(tag)))
        throw new Error('a mount tag cannot be both included and excluded');
    return {
        targetKind: input.targetKind,
        targetId,
        knowledgeBaseId,
        enabled: input.enabled,
        recallEnabled: input.recallEnabled,
        writeMode: input.writeMode,
        includeTags,
        excludeTags,
        extractionInstructions,
    };
}
export function isKnowledgeType(value) {
    return typeof value === 'string' && TYPE_SET.has(value);
}
export function normalizeKnowledgeSettings(input) {
    if (input.writebackPolicy !== undefined && input.writebackPolicy !== 'conservative' && input.writebackPolicy !== 'proactive') {
        throw new Error('knowledge writeback policy must be conservative or proactive');
    }
    const clearRoute = input.writebackProvider === null || input.writebackModel === null;
    const provider = typeof input.writebackProvider === 'string' ? input.writebackProvider.trim() : undefined;
    const model = typeof input.writebackModel === 'string' ? input.writebackModel.trim() : undefined;
    if (!clearRoute && (provider === undefined) !== (model === undefined))
        throw new Error('global writeback provider and model must be configured together');
    return {
        ...input.writebackPolicy === undefined ? {} : { writebackPolicy: input.writebackPolicy },
        ...clearRoute ? { writebackProvider: null, writebackModel: null } : provider && model ? { writebackProvider: provider, writebackModel: model } : {},
    };
}
//# sourceMappingURL=domain.js.map