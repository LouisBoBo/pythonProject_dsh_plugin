import { dirname, join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { migrateKnowledgeDatabase } from './storage/migrations.js';
import { noteExcerptMarkdown } from './note-excerpt.js';
import { contentHash, DEFAULT_KNOWLEDGE_BASE_ID, newId, normalizeDraft, normalizeKnowledgeBaseDraft, normalizeKnowledgeBaseGroup, normalizeKnowledgeMountDraft, normalizeKnowledgeSettings, nowIso, } from './domain.js';
import { markdownHash, renderKnowledgeMarkdown } from './documents/markdown.js';
import { knowledgeDocumentPath } from './documents/path.js';
import { KnowledgeDocumentStore } from './documents/store.js';
import { enqueueDocumentProjection } from './documents/projection-queue.js';
import { applyKnowledgeTextEdits, mergeKnowledgeBodies } from './knowledge-merge.js';
import { normalizeFinalizationChange } from './document-lifecycle.js';
import { NoteStore } from './notes/store.js';
import { isImportedOriginalEntryId, readImportedOriginalFile, removeImportedOriginal, writeImportedOriginal } from './knowledge-originals.js';
const ENTRY_COLUMNS = `
  id, knowledge_base_id, title, body, type, tags_json, scope_kind, scope_id, confidence,
  status, document_state, finalized_at, finalization_note, version, source_json, created_at, updated_at
`;
const JOINED_ENTRY_COLUMNS = `
  e.id AS id, e.knowledge_base_id AS knowledge_base_id, e.title AS title, e.body AS body, e.type AS type,
  e.tags_json AS tags_json, e.scope_kind AS scope_kind, e.scope_id AS scope_id,
  e.confidence AS confidence, e.status AS status, e.document_state AS document_state,
  e.finalized_at AS finalized_at, e.finalization_note AS finalization_note, e.version AS version,
  e.source_json AS source_json, e.created_at AS created_at, e.updated_at AS updated_at
`;
const EXTRACTION_LEASE_MS = 15 * 60 * 1000;
export class LocalKnowledgeProvider {
    mode = 'local';
    notes;
    db;
    documentStore;
    documentsReady;
    batchReviewTail = Promise.resolve();
    closed = false;
    constructor(path) {
        if (path !== ':memory:')
            mkdirSync(dirname(path), { recursive: true });
        const inMemory = path === ':memory:';
        const storageRoot = inMemory
            ? join(tmpdir(), `dsh-knowledge-${randomUUID()}`)
            : dirname(path);
        this.storageRoot = storageRoot;
        this.notes = new NoteStore(inMemory ? storageRoot : join(storageRoot, 'notes'), inMemory);
        this.documentStore = new KnowledgeDocumentStore(join(storageRoot, 'documents'));
        this.db = new DatabaseSync(path);
        this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        migrateKnowledgeDatabase(this.db, this.notes);
        this.db.exec('CREATE TABLE IF NOT EXISTS note_excerpt_receipts (request_id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, knowledge_id TEXT NOT NULL);');
        this.db.exec('CREATE TABLE IF NOT EXISTS writeback_receipts (source_key TEXT NOT NULL, proposal_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(source_key, proposal_hash));');
        this.documentsReady = this.enqueueDocumentSync(() => this.syncAllDocuments());
    }
    assertOpen() {
        if (this.closed)
            throw new Error('knowledge provider is closed');
    }
    async writebackProtocol() { return { idempotentDirectWrites: true }; }
    async getSettings() {
        this.assertOpen();
        const row = this.db.prepare('SELECT writeback_policy,writeback_provider,writeback_model,updated_at FROM knowledge_settings WHERE id=1').get();
        const provider = row.writeback_provider == null ? undefined : String(row.writeback_provider);
        const model = row.writeback_model == null ? undefined : String(row.writeback_model);
        return {
            writebackPolicy: String(row.writeback_policy),
            ...provider === undefined || model === undefined ? {} : { writebackProvider: provider, writebackModel: model },
            updatedAt: String(row.updated_at),
        };
    }
    async updateSettings(input) {
        this.assertOpen();
        const patch = normalizeKnowledgeSettings(input);
        const updatedAt = nowIso();
        const current = await this.getSettings();
        const clearRoute = patch.writebackProvider === null || patch.writebackModel === null;
        const next = {
            writebackPolicy: patch.writebackPolicy ?? current.writebackPolicy,
            ...clearRoute ? {} : patch.writebackProvider && patch.writebackModel
                ? { writebackProvider: patch.writebackProvider, writebackModel: patch.writebackModel }
                : current.writebackProvider && current.writebackModel ? { writebackProvider: current.writebackProvider, writebackModel: current.writebackModel } : {},
            updatedAt,
        };
        this.db.prepare('UPDATE knowledge_settings SET writeback_policy=?,writeback_provider=?,writeback_model=?,updated_at=? WHERE id=1')
            .run(next.writebackPolicy, next.writebackProvider ?? null, next.writebackModel ?? null, updatedAt);
        return next;
    }
    async listKnowledgeBases() {
        this.assertOpen();
        return this.db.prepare('SELECT * FROM knowledge_bases ORDER BY status, updated_at DESC, id').all()
            .map(rowToKnowledgeBase);
    }
    async getKnowledgeBase(id) {
        this.assertOpen();
        const row = this.db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id);
        return row === undefined ? undefined : rowToKnowledgeBase(row);
    }
    async createKnowledgeBase(input) {
        this.assertOpen();
        await this.documentsReady;
        const draft = normalizeKnowledgeBaseDraft(input);
        const timestamp = nowIso();
        const base = { ...draft, id: newId(), status: 'active', createdAt: timestamp, updatedAt: timestamp };
        this.db.prepare(`
      INSERT INTO knowledge_bases(
        id,name,description,default_tags_json,extraction_instructions,writeback_policy,writeback_provider,writeback_model,status,created_at,updated_at,group_name
      ) VALUES(?,?,?,?,?,?,?,?,'active',?,?,?)
    `).run(base.id, base.name, base.description, JSON.stringify(base.defaultTags), base.extractionInstructions, base.writebackPolicy, base.writebackProvider ?? null, base.writebackModel ?? null, timestamp, timestamp, base.group ?? '');
        await this.syncKnowledgeBaseManifestQueued(base.id);
        return base;
    }
    async updateKnowledgeBase(id, input) {
        this.assertOpen();
        await this.documentsReady;
        const current = await this.getKnowledgeBase(id);
        if (current === undefined)
            throw notFound('knowledge base', id);
        // Older clients omit grouping from their full editor payload; preserve it.
        const draft = normalizeKnowledgeBaseDraft({ ...input, group: input.group ?? current.group ?? '' });
        const updated = {
            id: current.id,
            status: current.status,
            createdAt: current.createdAt,
            ...draft,
            updatedAt: nowIso(),
        };
        this.db.prepare(`
      UPDATE knowledge_bases SET
        name=?,description=?,default_tags_json=?,extraction_instructions=?,writeback_policy=?,writeback_provider=?,writeback_model=?,updated_at=?,group_name=?
      WHERE id=?
    `).run(updated.name, updated.description, JSON.stringify(updated.defaultTags), updated.extractionInstructions, updated.writebackPolicy, updated.writebackProvider ?? null, updated.writebackModel ?? null, updated.updatedAt, updated.group ?? '', id);
        await this.syncKnowledgeBaseManifestQueued(id);
        return updated;
    }
    async patchKnowledgeBase(id, patch) {
        this.assertOpen();
        const current = await this.getKnowledgeBase(id);
        if (current === undefined)
            throw notFound('knowledge base', id);
        const clearRoute = patch.writebackProvider === null || patch.writebackModel === null;
        const provider = typeof patch.writebackProvider === 'string' ? patch.writebackProvider : current.writebackProvider;
        const model = typeof patch.writebackModel === 'string' ? patch.writebackModel : current.writebackModel;
        return this.updateKnowledgeBase(id, {
            name: patch.name ?? current.name,
            group: patch.group === null ? '' : patch.group ?? current.group ?? '',
            description: patch.description ?? current.description,
            defaultTags: patch.defaultTags ?? current.defaultTags,
            extractionInstructions: patch.extractionInstructions ?? current.extractionInstructions,
            writebackPolicy: patch.writebackPolicy ?? current.writebackPolicy,
            ...clearRoute || provider === undefined || model === undefined ? {} : { writebackProvider: provider, writebackModel: model },
        });
    }
    async assignKnowledgeBaseGroup(ids, value) {
        this.assertOpen();
        await this.documentsReady;
        const group = normalizeKnowledgeBaseGroup(value);
        const unique = [...new Set(ids)];
        if (!unique.length || unique.length > 1000)
            throw new Error('select 1-1000 knowledge bases');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            for (const id of unique) {
                if (!this.db.prepare('SELECT id FROM knowledge_bases WHERE id=?').get(id))
                    throw notFound('knowledge base', id);
            }
            const update = this.db.prepare('UPDATE knowledge_bases SET group_name=?,updated_at=? WHERE id=?');
            const timestamp = nowIso();
            for (const id of unique)
                update.run(group, timestamp, id);
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
        for (const id of unique)
            await this.syncKnowledgeBaseManifestQueued(id);
        return (await this.listKnowledgeBases()).filter(base => unique.includes(base.id));
    }
    async archiveKnowledgeBase(id) {
        this.assertOpen();
        if (id === DEFAULT_KNOWLEDGE_BASE_ID)
            throw conflict('the default knowledge base cannot be archived');
        const current = await this.getKnowledgeBase(id);
        if (current === undefined)
            throw notFound('knowledge base', id);
        if (current.status === 'archived')
            return current;
        const updated = { ...current, status: 'archived', updatedAt: nowIso() };
        this.transaction(() => {
            this.db.prepare("UPDATE knowledge_bases SET status='archived',updated_at=? WHERE id=?").run(updated.updatedAt, id);
            this.db.prepare('UPDATE knowledge_mounts SET enabled=0,updated_at=? WHERE knowledge_base_id=?').run(updated.updatedAt, id);
        });
        return updated;
    }
    async restoreKnowledgeBase(id) {
        this.assertOpen();
        const current = await this.getKnowledgeBase(id);
        if (current === undefined)
            throw notFound('knowledge base', id);
        if (current.status === 'active')
            return current;
        const updated = { ...current, status: 'active', updatedAt: nowIso() };
        this.db.prepare("UPDATE knowledge_bases SET status='active',updated_at=? WHERE id=?").run(updated.updatedAt, id);
        return updated;
    }
    async deleteKnowledgeBase(id) {
        this.assertOpen();
        await this.documentsReady;
        const base = await this.getKnowledgeBase(id);
        if (id === DEFAULT_KNOWLEDGE_BASE_ID)
            throw conflict('the default knowledge base cannot be deleted');
        if (base === undefined)
            throw notFound('knowledge base', id);
        if (base.status !== 'archived')
            throw conflict('knowledge base must be archived before deletion');
        await this.enqueueDocumentSync(() => this.documentStore.deleteBase(this.documentStore.baseDirectory(base)));
        try {
            this.transaction(() => {
                const row = this.db.prepare('SELECT status FROM knowledge_bases WHERE id=?').get(id);
                if (row === undefined)
                    throw notFound('knowledge base', id);
                if (row.status !== 'archived')
                    throw conflict('knowledge base must be archived before deletion');
                this.db.prepare(`
          DELETE FROM knowledge_candidates
          WHERE json_extract(draft_json, '$.knowledgeBaseId')=?
             OR target_id IN (SELECT id FROM knowledge_entries WHERE knowledge_base_id=?)
        `).run(id, id);
                this.db.prepare(`
          DELETE FROM knowledge_fts
          WHERE knowledge_id IN (SELECT id FROM knowledge_entries WHERE knowledge_base_id=?)
        `).run(id);
                this.db.prepare('DELETE FROM knowledge_entries WHERE knowledge_base_id=?').run(id);
                this.db.prepare('DELETE FROM knowledge_mounts WHERE knowledge_base_id=?').run(id);
                this.db.prepare('DELETE FROM knowledge_documents WHERE knowledge_base_id=?').run(id);
                this.db.prepare('DELETE FROM knowledge_bases WHERE id=?').run(id);
            });
        }
        catch (error) {
            await this.syncKnowledgeDocumentsQueued(id).catch(() => { });
            throw error;
        }
    }
    async listDocuments(knowledgeBaseId, query) {
        this.assertOpen();
        await this.documentsReady;
        const where = [];
        const args = [];
        if (knowledgeBaseId !== undefined) {
            where.push('d.knowledge_base_id=?');
            args.push(knowledgeBaseId);
        }
        const text = query?.trim();
        if (text) {
            where.push('(d.title LIKE ? ESCAPE \'\\\' OR d.rel_path LIKE ? ESCAPE \'\\\' OR d.content LIKE ? ESCAPE \'\\\')');
            const like = `%${text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
            args.push(like, like, like);
        }
        const sql = `SELECT d.*, e.source_json AS entry_source_json
      FROM knowledge_documents d
      LEFT JOIN knowledge_entries e ON e.id = d.id
      ${where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`}
      ORDER BY d.knowledge_base_id, CASE WHEN d.rel_path='README.md' THEN 0 ELSE 1 END, d.rel_path`;
        return this.db.prepare(sql).all(...args).map(rowToDocument);
    }
    async listDocumentIndex(request) {
        this.assertOpen();
        await this.documentsReady;
        const limit = Math.max(1, Math.min(request.limit, 100));
        const where = [];
        const args = [];
        const knowledgeBaseIds = request.knowledgeBaseIds === undefined
            ? undefined
            : [...new Set(request.knowledgeBaseIds.map(id => id.trim()).filter(Boolean))];
        if (knowledgeBaseIds !== undefined && knowledgeBaseIds.length === 0)
            return { items: [], total: 0 };
        if (knowledgeBaseIds !== undefined) {
            where.push(`d.knowledge_base_id IN (${knowledgeBaseIds.map(() => '?').join(',')})`);
            args.push(...knowledgeBaseIds);
        }
        if (request.activeKnowledgeBasesOnly) {
            where.push("d.knowledge_base_id IN (SELECT id FROM knowledge_bases WHERE status='active')");
        }
        const query = request.query?.trim();
        if (query) {
            const like = `%${escapeSqlLike(query)}%`;
            where.push(`(d.title LIKE ? ESCAPE '\\' OR d.rel_path LIKE ? ESCAPE '\\' OR d.content LIKE ? ESCAPE '\\')`);
            args.push(like, like, like);
        }
        const sourceWhere = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;
        const cursorWhere = [];
        const cursorArgs = [];
        if (request.cursor !== undefined) {
            const cursor = decodeDocumentCursor(request.cursor);
            cursorWhere.push(`(
        knowledge_base_id > ? OR
        (knowledge_base_id = ? AND sort_rank > ?) OR
        (knowledge_base_id = ? AND sort_rank = ? AND rel_path > ?) OR
        (knowledge_base_id = ? AND sort_rank = ? AND rel_path = ? AND id > ?)
      )`);
            cursorArgs.push(cursor.knowledgeBaseId, cursor.knowledgeBaseId, cursor.sortRank, cursor.knowledgeBaseId, cursor.sortRank, cursor.relPath, cursor.knowledgeBaseId, cursor.sortRank, cursor.relPath, cursor.id);
        }
        const rows = this.db.prepare(`
      WITH document_index AS (
        SELECT
          d.id, d.knowledge_base_id, d.rel_path, d.title, d.entry_count, d.content_hash,
          d.document_state, d.finalized_at, d.finalization_note, d.created_at, d.updated_at,
          e.source_json AS entry_source_json,
          CASE WHEN d.rel_path='README.md' THEN 0 ELSE 1 END AS sort_rank
        FROM knowledge_documents d
        LEFT JOIN knowledge_entries e ON e.id = d.id
        ${sourceWhere}
      )
      SELECT * FROM document_index
      ${cursorWhere.length === 0 ? '' : `WHERE ${cursorWhere.join(' AND ')}`}
      ORDER BY knowledge_base_id, sort_rank, rel_path, id
      LIMIT ?
    `).all(...args, ...cursorArgs, limit + 1);
        const pageRows = rows.slice(0, limit);
        const items = pageRows.map(rowToDocumentSummary);
        const last = pageRows.at(-1);
        const total = Number(this.db.prepare(`SELECT COUNT(*) AS total FROM knowledge_documents d${sourceWhere}`).get(...args).total ?? 0);
        return {
            items,
            total,
            ...rows.length <= limit || last === undefined ? {} : {
                nextCursor: encodeDocumentCursor(String(last.knowledge_base_id), Number(last.sort_rank), String(last.rel_path), String(last.id)),
            },
        };
    }
    async getDocument(id) {
        this.assertOpen();
        await this.documentsReady;
        const row = this.db.prepare('SELECT d.*, e.source_json AS entry_source_json FROM knowledge_documents d LEFT JOIN knowledge_entries e ON e.id = d.id WHERE d.id=?').get(id);
        return row === undefined ? undefined : rowToDocument(row);
    }
    async listMounts(targetKind, targetId) {
        this.assertOpen();
        const where = [];
        const args = [];
        if (targetKind !== undefined) {
            where.push('target_kind=?');
            args.push(targetKind);
        }
        if (targetId !== undefined) {
            where.push('target_id=?');
            args.push(targetId);
        }
        return this.db.prepare(`SELECT * FROM knowledge_mounts${where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`} ORDER BY updated_at DESC`)
            .all(...args).map(rowToMount);
    }
    async upsertMount(input) {
        this.assertOpen();
        return this.upsertMountRow(input);
    }
    async applyMountBatch(batch) {
        this.assertOpen();
        if (batch.upserts.length + batch.deleteIds.length > 500)
            throw new Error('mount batch must contain at most 500 operations');
        const deleteIds = [...new Set(batch.deleteIds.map(id => id.trim()).filter(Boolean))];
        return this.transaction(() => {
            const mounts = batch.upserts.map(input => this.upsertMountRow(input));
            for (const id of deleteIds) {
                const result = this.db.prepare('DELETE FROM knowledge_mounts WHERE id=?').run(id);
                if (result.changes === 0)
                    throw notFound('knowledge mount', id);
            }
            return { mounts, deletedIds: deleteIds };
        });
    }
    upsertMountRow(input) {
        const draft = normalizeKnowledgeMountDraft(input);
        const base = this.db.prepare('SELECT status FROM knowledge_bases WHERE id=?').get(draft.knowledgeBaseId);
        if (base === undefined)
            throw notFound('knowledge base', draft.knowledgeBaseId);
        if (base.status !== 'active')
            throw conflict(`knowledge base "${draft.knowledgeBaseId}" is archived`);
        const previous = this.db.prepare(`
      SELECT * FROM knowledge_mounts WHERE target_kind=? AND target_id=? AND knowledge_base_id=?
    `).get(draft.targetKind, draft.targetId, draft.knowledgeBaseId);
        const timestamp = nowIso();
        const mount = {
            ...draft,
            id: previous === undefined ? newId() : String(previous.id),
            createdAt: previous === undefined ? timestamp : String(previous.created_at),
            updatedAt: timestamp,
        };
        this.db.prepare(`
      INSERT INTO knowledge_mounts(
        id,target_kind,target_id,knowledge_base_id,enabled,recall_enabled,write_mode,
        include_tags_json,exclude_tags_json,extraction_instructions,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(target_kind,target_id,knowledge_base_id) DO UPDATE SET
        enabled=excluded.enabled,recall_enabled=excluded.recall_enabled,write_mode=excluded.write_mode,
        include_tags_json=excluded.include_tags_json,exclude_tags_json=excluded.exclude_tags_json,
        extraction_instructions=excluded.extraction_instructions,updated_at=excluded.updated_at
    `).run(mount.id, mount.targetKind, mount.targetId, mount.knowledgeBaseId, mount.enabled ? 1 : 0, mount.recallEnabled ? 1 : 0, mount.writeMode, JSON.stringify(mount.includeTags), JSON.stringify(mount.excludeTags), mount.extractionInstructions, mount.createdAt, mount.updatedAt);
        return mount;
    }
    async deleteMount(id) {
        this.assertOpen();
        const result = this.db.prepare('DELETE FROM knowledge_mounts WHERE id=?').run(id);
        if (result.changes === 0)
            throw notFound('knowledge mount', id);
    }
    async resolveMounts(sessionId, projectId) {
        this.assertOpen();
        const project = projectId === undefined ? [] : await this.listMounts('project', projectId);
        const session = await this.listMounts('session', sessionId);
        const resolved = new Map();
        for (const mount of project)
            resolved.set(mount.knowledgeBaseId, { mount, inheritedFrom: 'project' });
        for (const mount of session)
            resolved.set(mount.knowledgeBaseId, { mount });
        const bases = new Map((await this.listKnowledgeBases()).map(base => [base.id, base]));
        const output = [];
        for (const { mount, inheritedFrom } of resolved.values()) {
            if (!mount.enabled)
                continue;
            const base = bases.get(mount.knowledgeBaseId);
            if (base === undefined || base.status !== 'active')
                continue;
            output.push({ ...mount, base, ...inheritedFrom === undefined ? {} : { inheritedFrom } });
        }
        return output.sort((left, right) => left.base.name.localeCompare(right.base.name, 'zh-CN'));
    }
    async stats() {
        this.assertOpen();
        const entryRows = this.db.prepare('SELECT status, type, COUNT(*) AS count FROM knowledge_entries GROUP BY status, type').all();
        const candidateRows = this.db.prepare('SELECT status, COUNT(*) AS count FROM knowledge_candidates GROUP BY status').all();
        const jobRows = this.db.prepare('SELECT status, COUNT(*) AS count FROM extraction_jobs GROUP BY status').all();
        const baseRows = this.db.prepare('SELECT status, COUNT(*) AS count FROM knowledge_bases GROUP BY status').all();
        const byType = {
            preference: 0,
            fact: 0,
            decision: 0,
            procedure: 0,
            lesson: 0,
        };
        let active = 0;
        let archived = 0;
        for (const row of entryRows) {
            const count = Number(row.count);
            byType[String(row.type)] += count;
            if (row.status === 'active')
                active += count;
            if (row.status === 'archived')
                archived += count;
        }
        const candidates = { pending: 0, approved: 0, rejected: 0 };
        for (const row of candidateRows)
            candidates[String(row.status)] = Number(row.count);
        const extractionJobs = { running: 0, completed: 0, failed: 0 };
        for (const row of jobRows)
            extractionJobs[String(row.status)] = Number(row.count);
        const knowledgeBases = { active: 0, archived: 0 };
        for (const row of baseRows)
            knowledgeBases[String(row.status)] = Number(row.count);
        return {
            knowledgeBases: { total: knowledgeBases.active + knowledgeBases.archived, ...knowledgeBases },
            entries: { total: active + archived, active, archived, byType },
            candidates: { total: candidates.pending + candidates.approved + candidates.rejected, ...candidates },
            extractionJobs: { total: extractionJobs.running + extractionJobs.completed + extractionJobs.failed, ...extractionJobs },
        };
    }
    transaction(operation) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = operation();
            this.db.exec('COMMIT');
            return result;
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    async search(request) {
        this.assertOpen();
        const limit = Math.max(0, Math.min(request.limit, 100));
        if (limit === 0)
            return [];
        const scopeSql = request.projectId === undefined
            ? `e.scope_kind = 'global'`
            : `(e.scope_kind = 'global' OR (e.scope_kind = 'project' AND e.scope_id = ?))`;
        const scopeArgs = request.projectId === undefined ? [] : [request.projectId];
        const typeSql = request.types === undefined || request.types.length === 0
            ? ''
            : ` AND e.type IN (${request.types.map(() => '?').join(',')})`;
        const typeArgs = request.types ?? [];
        const baseIds = [...new Set(request.knowledgeBaseIds ?? [])].filter(Boolean);
        const baseSql = baseIds.length === 0 ? '' : ` AND e.knowledge_base_id IN (${baseIds.map(() => '?').join(',')})`;
        const includeTags = [...new Set(request.includeTags ?? [])].filter(Boolean);
        const includeSql = includeTags.length === 0 ? '' : ` AND EXISTS (
      SELECT 1 FROM json_each(e.tags_json) tags WHERE tags.value IN (${includeTags.map(() => '?').join(',')})
    )`;
        const excludeTags = [...new Set(request.excludeTags ?? [])].filter(Boolean);
        const excludeSql = excludeTags.length === 0 ? '' : ` AND NOT EXISTS (
      SELECT 1 FROM json_each(e.tags_json) tags WHERE tags.value IN (${excludeTags.map(() => '?').join(',')})
    )`;
        const filterSql = `${typeSql}${baseSql}${includeSql}${excludeSql}`;
        const filterArgs = [...typeArgs, ...baseIds, ...includeTags, ...excludeTags];
        const text = request.text.trim();
        let rows;
        if (text.length === 0) {
            rows = this.db.prepare(`
        SELECT ${ENTRY_COLUMNS}, 0.0 AS rank
        FROM knowledge_entries e
        WHERE e.status = 'active' AND ${scopeSql}${filterSql}
        ORDER BY CASE WHEN e.scope_kind = 'project' THEN 0 ELSE 1 END, e.updated_at DESC
        LIMIT ?
      `).all(...scopeArgs, ...filterArgs, limit);
        }
        else {
            const ftsQuery = toFtsQuery(text);
            try {
                rows = this.db.prepare(`
          SELECT ${JOINED_ENTRY_COLUMNS}, bm25(knowledge_fts, 0.0, 4.0, 1.0, 0.5) AS rank
          FROM knowledge_fts
          JOIN knowledge_entries e ON e.id = knowledge_fts.knowledge_id
          WHERE knowledge_fts MATCH ? AND e.status = 'active' AND ${scopeSql}${filterSql}
          ORDER BY CASE WHEN e.scope_kind = 'project' THEN 0 ELSE 1 END, rank, e.updated_at DESC
          LIMIT ?
        `).all(ftsQuery, ...scopeArgs, ...filterArgs, limit);
            }
            catch {
                rows = [];
            }
            if (rows.length < limit) {
                const supplements = this.searchByTerms(text, scopeSql, scopeArgs, filterSql, filterArgs, limit);
                const seen = new Set(rows.map(row => String(row.id)));
                rows.push(...supplements.filter(row => !seen.has(String(row.id))).slice(0, limit - rows.length));
            }
        }
        return rows.map(row => {
            const entry = rowToEntry(row);
            return { entry, score: relevanceScore(entry, text) };
        }).sort((left, right) => right.score - left.score || right.entry.updatedAt.localeCompare(left.entry.updatedAt));
    }
    searchByTerms(text, scopeSql, scopeArgs, filterSql, filterArgs, limit) {
        const terms = fallbackTerms(text);
        if (terms.length === 0)
            return [];
        const clauses = terms.map(() => `(e.title LIKE ? ESCAPE '\\' OR e.body LIKE ? ESCAPE '\\' OR e.tags_json LIKE ? ESCAPE '\\')`);
        const args = terms.flatMap((term) => {
            const like = `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
            return [like, like, like];
        });
        return this.db.prepare(`
      SELECT ${ENTRY_COLUMNS}, 3.0 AS rank
      FROM knowledge_entries e
      WHERE e.status = 'active' AND ${scopeSql}${filterSql} AND (${clauses.join(' OR ')})
      ORDER BY CASE WHEN e.scope_kind = 'project' THEN 0 ELSE 1 END, e.updated_at DESC
      LIMIT ?
    `).all(...scopeArgs, ...filterArgs, ...args, limit);
    }
    async list(request) {
        this.assertOpen();
        const limit = Math.max(1, Math.min(request.limit, 100));
        const where = [];
        const args = [];
        if (request.status !== undefined) {
            where.push('status = ?');
            args.push(request.status);
        }
        if (request.type !== undefined) {
            where.push('type = ?');
            args.push(request.type);
        }
        if (request.knowledgeBaseId !== undefined) {
            where.push('knowledge_base_id = ?');
            args.push(request.knowledgeBaseId);
        }
        if (request.projectId !== undefined) {
            where.push(`(scope_kind = 'global' OR (scope_kind = 'project' AND scope_id = ?))`);
            args.push(request.projectId);
        }
        if (request.cursor !== undefined) {
            const cursor = decodeCursor(request.cursor);
            where.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
            args.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
        }
        const sql = `SELECT ${ENTRY_COLUMNS} FROM knowledge_entries${where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`} ORDER BY updated_at DESC, id DESC LIMIT ?`;
        const rows = this.db.prepare(sql).all(...args, limit + 1);
        const page = rows.slice(0, limit).map(rowToEntry);
        const last = page.at(-1);
        return {
            items: page,
            ...rows.length <= limit || last === undefined ? {} : { nextCursor: encodeCursor(last.updatedAt, last.id) },
        };
    }
    async get(id) {
        this.assertOpen();
        const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id = ?`).get(id);
        return row === undefined ? undefined : rowToEntry(row);
    }
    /** Management-only bulk lookup used to avoid one HTTP/SQL round trip per review target. */
    entriesByIds(ids) {
        this.assertOpen();
        const uniqueIds = [...new Set(ids.map(id => id.trim()).filter(Boolean))].slice(0, 100);
        if (uniqueIds.length === 0)
            return [];
        const placeholders = uniqueIds.map(() => '?').join(',');
        const rows = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id IN (${placeholders})`)
            .all(...uniqueIds);
        const entries = new Map(rows.map(row => {
            const entry = rowToEntry(row);
            return [entry.id, entry];
        }));
        return uniqueIds.flatMap(id => {
            const entry = entries.get(id);
            return entry === undefined ? [] : [entry];
        });
    }
    async versions(id) {
        this.assertOpen();
        const rows = this.db.prepare('SELECT * FROM knowledge_versions WHERE knowledge_id = ? ORDER BY version DESC').all(id);
        return rows.map(rowToVersion);
    }
    async create(draft) {
        this.assertOpen();
        await this.documentsReady;
        const entry = this.transaction(() => this.insertEntry(draft));
        await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    async saveImportedOriginal(entryId, filename, buffer) {
        this.assertOpen();
        await writeImportedOriginal(this.storageRoot, entryId, filename, buffer);
    }
    async readImportedOriginal(entryId) {
        this.assertOpen();
        const entry = await this.get(entryId);
        if (entry === undefined)
            return undefined;
        const source = entry.source;
        const originalId = source?.kind === 'imported-file' && isImportedOriginalEntryId(source.originalEntryId)
            ? source.originalEntryId
            : entry.id;
        const original = originalId === entry.id ? entry : await this.get(originalId);
        if (original?.source?.kind !== 'imported-file' || !original.source.filename)
            return undefined;
        if (original.knowledgeBaseId !== entry.knowledgeBaseId)
            return undefined;
        try {
            const content = await readImportedOriginalFile(this.storageRoot, original.id, original.source.filename);
            return {
                filename: original.source.filename,
                mediaType: original.source.mediaType || 'application/octet-stream',
                content,
            };
        }
        catch {
            return undefined;
        }
    }
    async excerptNote(input) {
        this.assertOpen();
        await this.documentsReady;
        if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId))
            throw inputError('无效的摘录请求标识');
        if (!/^note_[a-f0-9]{32}$/.test(input.noteId))
            throw inputError('无效的来源笔记');
        if (!input.text.trim() || input.text.length > 50_000)
            throw inputError('请选择 1 到 50000 字的笔记内容');
        const body = noteExcerptMarkdown(input.noteId, input.text);
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const entry = this.transaction(() => {
            const receipt = this.db.prepare('SELECT input_hash,knowledge_id FROM note_excerpt_receipts WHERE request_id=?').get(input.requestId);
            if (receipt) {
                if (receipt.input_hash !== hash)
                    throw conflict('本次摘录请求已提交，请重新打开摘录窗口');
                const previous = this.entriesByIds([String(receipt.knowledge_id)])[0];
                if (!previous)
                    throw conflict('已摘录的知识文档已删除，不会重复创建');
                return previous;
            }
            const note = this.notes.get(input.noteId);
            if (!note || note.kind === 'folder')
                throw inputError('来源笔记已删除或不可用');
            let result;
            if (input.documentId) {
                const current = this.entriesByIds([input.documentId])[0];
                if (!current || current.knowledgeBaseId !== input.knowledgeBaseId)
                    throw conflict('目标知识文档不存在或已移动');
                if (current.status !== 'active' || current.documentState !== 'open')
                    throw conflict('目标文档已归档或定稿，请选择可编辑的文档');
                if (current.version !== input.expectedVersion)
                    throw conflict('目标文档已更新，请重新选择后确认摘录');
                if (!this.db.prepare("SELECT id FROM knowledge_bases WHERE id=? AND status='active'").get(current.knowledgeBaseId))
                    throw conflict('目标知识库已归档');
                result = this.updateEntry(current.id, { ...current, body: `${current.body.trimEnd()}\n\n${body}`.trim() }, 'update');
            }
            else {
                result = this.insertEntry({ knowledgeBaseId: input.knowledgeBaseId, title: input.title?.trim() || note.name.replace(/\.md$/i, ''), body, type: 'fact', tags: [], scope: { kind: 'global' }, confidence: 0.8 });
            }
            this.db.prepare('INSERT OR IGNORE INTO knowledge_note_references(knowledge_id,note_id,source,source_session_id,created_at) VALUES(?,?,?,NULL,?)').run(result.id, note.id, 'user', nowIso());
            this.db.prepare('INSERT INTO note_excerpt_receipts(request_id,input_hash,knowledge_id) VALUES(?,?,?)').run(input.requestId, hash, result.id);
            return result;
        });
        await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    insertEntry(input) {
        const draft = normalizeDraft(input);
        if (this.db.prepare("SELECT id FROM knowledge_bases WHERE id=? AND status='active'").get(draft.knowledgeBaseId) === undefined) {
            throw notFound('active knowledge base', draft.knowledgeBaseId);
        }
        const id = newId();
        const timestamp = nowIso();
        const entry = {
            ...draft, id, status: 'active', documentState: 'open', version: 1,
            createdAt: timestamp, updatedAt: timestamp,
        };
        this.db.prepare(`
      INSERT INTO knowledge_entries (
        id,knowledge_base_id,title,body,type,tags_json,scope_kind,scope_id,confidence,status,
        document_state,finalized_at,finalization_note,version,content_hash,source_json,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,'open',NULL,NULL,?,?,?,?,?)
    `).run(id, draft.knowledgeBaseId, draft.title, draft.body, draft.type, JSON.stringify(draft.tags), draft.scope.kind, draft.scope.kind === 'project' ? draft.scope.id : null, draft.confidence, 'active', 1, contentHash(draft), draft.source === undefined ? null : JSON.stringify(draft.source), timestamp, timestamp);
        this.writeVersion(entry, 'create');
        this.upsertFts(entry);
        return entry;
    }
    async update(id, draft, _signal, expectedVersion) {
        this.assertOpen();
        await this.documentsReady;
        const entry = this.transaction(() => {
            if (expectedVersion !== undefined) {
                const current = this.entriesByIds([id])[0];
                if (current === undefined || current.version !== expectedVersion)
                    throw conflict('文档已被修改，请重新读取并合并后保存');
            }
            return this.updateEntry(id, draft, 'update');
        });
        await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    async finalize(id, state, note) {
        this.assertOpen();
        await this.documentsReady;
        const entry = this.transaction(() => this.finalizeEntry(id, state, note));
        await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    finalizeEntry(id, state, note) {
        const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id=?`).get(id);
        if (row === undefined)
            throw notFound('knowledge entry', id);
        const current = rowToEntry(row);
        if (current.status !== 'active')
            throw conflict('only active knowledge documents can be finalized');
        const finalizationNote = normalizeFinalizationNote(note);
        if (current.documentState === state && current.finalizationNote === finalizationNote)
            return current;
        if (current.documentState !== 'open')
            throw finalizedConflict(current);
        const timestamp = nowIso();
        const updated = {
            ...current,
            documentState: state,
            finalizedAt: timestamp,
            ...finalizationNote === undefined ? {} : { finalizationNote },
            version: current.version + 1,
            updatedAt: timestamp,
        };
        this.db.prepare(`
      UPDATE knowledge_entries
      SET document_state=?,finalized_at=?,finalization_note=?,version=?,updated_at=?
      WHERE id=?
    `).run(state, timestamp, finalizationNote ?? null, updated.version, timestamp, id);
        this.writeVersion(updated, 'update');
        this.upsertFts(updated);
        return updated;
    }
    async reopen(id) {
        this.assertOpen();
        await this.documentsReady;
        const entry = this.transaction(() => {
            const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id=?`).get(id);
            if (row === undefined)
                throw notFound('knowledge entry', id);
            const current = rowToEntry(row);
            if (current.status !== 'active')
                throw conflict('only active knowledge documents can be reopened');
            if (current.documentState === 'open')
                return current;
            const timestamp = nowIso();
            const { finalizedAt: _finalizedAt, finalizationNote: _finalizationNote, ...reopened } = current;
            const updated = {
                ...reopened,
                documentState: 'open',
                version: current.version + 1,
                updatedAt: timestamp,
            };
            this.db.prepare(`
        UPDATE knowledge_entries
        SET document_state='open',finalized_at=NULL,finalization_note=NULL,version=?,updated_at=?
        WHERE id=?
      `).run(updated.version, timestamp, id);
            this.writeVersion(updated, 'update');
            this.upsertFts(updated);
            return updated;
        });
        await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    async moveDocument(id, knowledgeBaseId) {
        this.assertOpen();
        await this.documentsReady;
        let changed = false;
        const entry = this.transaction(() => {
            const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id=?`).get(id);
            if (row === undefined)
                throw notFound('knowledge entry', id);
            const current = rowToEntry(row);
            if (current.status !== 'active')
                throw conflict('only active knowledge documents can be moved');
            if (current.knowledgeBaseId === knowledgeBaseId)
                return current;
            if (this.db.prepare("SELECT id FROM knowledge_bases WHERE id=? AND status='active'").get(knowledgeBaseId) === undefined) {
                throw notFound('active knowledge base', knowledgeBaseId);
            }
            const updated = {
                ...current,
                knowledgeBaseId,
                version: current.version + 1,
                updatedAt: nowIso(),
            };
            this.db.prepare(`
        UPDATE knowledge_entries
        SET knowledge_base_id=?,version=?,updated_at=?
        WHERE id=?
      `).run(knowledgeBaseId, updated.version, updated.updatedAt, id);
            this.writeVersion(updated, 'update');
            changed = true;
            return updated;
        });
        if (changed)
            await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    updateEntry(id, input, changeKind) {
        const currentRow = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id = ?`).get(id);
        if (currentRow === undefined)
            throw notFound('knowledge entry', id);
        const current = rowToEntry(currentRow);
        if (current.status !== 'active' && changeKind !== 'restore') {
            throw conflict(`knowledge document "${current.title}" is archived and cannot be edited`);
        }
        if (current.documentState !== 'open')
            throw finalizedConflict(current);
        const draft = normalizeDraft(input);
        if (this.db.prepare("SELECT id FROM knowledge_bases WHERE id=? AND status='active'").get(draft.knowledgeBaseId) === undefined) {
            throw notFound('active knowledge base', draft.knowledgeBaseId);
        }
        const timestamp = nowIso();
        const source = draft.source === undefined ? current.source : draft.source;
        const entry = {
            ...draft,
            ...source === undefined ? {} : { source },
            id,
            status: 'active',
            documentState: current.documentState,
            version: current.version + 1,
            createdAt: current.createdAt,
            updatedAt: timestamp,
        };
        this.db.prepare(`
      UPDATE knowledge_entries SET
        knowledge_base_id=?,title=?,body=?,type=?,tags_json=?,scope_kind=?,scope_id=?,confidence=?,status='active',
        version=?,content_hash=?,source_json=?,updated_at=?
      WHERE id=?
    `).run(draft.knowledgeBaseId, draft.title, draft.body, draft.type, JSON.stringify(draft.tags), draft.scope.kind, draft.scope.kind === 'project' ? draft.scope.id : null, draft.confidence, entry.version, contentHash(draft), source === undefined ? null : JSON.stringify(source), timestamp, id);
        this.writeVersion(entry, changeKind);
        this.upsertFts(entry);
        return entry;
    }
    async archive(id) {
        this.assertOpen();
        await this.documentsReady;
        const entry = this.transaction(() => {
            const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id = ?`).get(id);
            if (row === undefined)
                throw notFound('knowledge entry', id);
            const current = rowToEntry(row);
            if (current.status === 'archived')
                return current;
            const updated = { ...current, status: 'archived', version: current.version + 1, updatedAt: nowIso() };
            this.db.prepare(`UPDATE knowledge_entries SET status='archived', version=?, updated_at=? WHERE id=?`).run(updated.version, updated.updatedAt, id);
            this.writeVersion(updated, 'archive');
            this.db.prepare('DELETE FROM knowledge_fts WHERE knowledge_id = ?').run(id);
            return updated;
        });
        await this.syncKnowledgeEntryQueued(entry.id);
        return entry;
    }
    async delete(id) {
        this.assertOpen();
        await this.documentsReady;
        const current = await this.get(id);
        this.transaction(() => {
            this.db.prepare('DELETE FROM knowledge_fts WHERE knowledge_id = ?').run(id);
            const result = this.db.prepare('DELETE FROM knowledge_entries WHERE id = ?').run(id);
            if (result.changes === 0)
                throw notFound('knowledge entry', id);
        });
        if (current !== undefined)
            await this.syncKnowledgeEntryQueued(current.id);
        if (current !== undefined)
            await removeImportedOriginal(this.storageRoot, id).catch(() => {});
    }
    async listNotes(request = {}) {
        this.assertOpen();
        return this.notes.list(request);
    }
    async getNote(id) {
        this.assertOpen();
        return this.notes.get(id);
    }
    async readNote(id) {
        this.assertOpen();
        return this.notes.readSnapshot(id);
    }
    async listNoteVersions(id, limit = 100) {
        this.assertOpen();
        return this.notes.listVersions(id, limit);
    }
    async readNoteVersion(id, version) {
        this.assertOpen();
        return this.notes.readVersion(id, version);
    }
    async restoreNoteVersion(id, version, expectedVersion) {
        this.assertOpen();
        return this.notes.restoreVersion(id, version, expectedVersion);
    }
    async createNoteFolder(name, parentId = null) {
        this.assertOpen();
        return this.notes.createFolder(name, parentId);
    }
    async createNoteDocument(name, parentId = null, content = '') {
        this.assertOpen();
        return this.notes.createDocument(name, parentId, content);
    }
    async updateNoteContent(id, content, _signal, expectedVersion) {
        this.assertOpen();
        return this.notes.updateContent(id, content, expectedVersion);
    }
    async renameNote(id, name) {
        this.assertOpen();
        return this.notes.rename(id, name);
    }
    async moveNote(id, parentId) {
        this.assertOpen();
        return this.notes.move(id, parentId);
    }
    async deleteNote(id) {
        this.assertOpen();
        const noteIds = this.notes.subtree(id).filter(node => node.kind !== 'folder').map(node => node.id);
        const references = this.noteReferencesForNotes(noteIds);
        if (references.length > 0)
            throw conflict(`note content is referenced by ${references.length} knowledge document(s)`);
        await this.notes.delete(id);
        this.deleteNoteReferences(noteIds);
    }
    async searchNotes(query, limit) {
        this.assertOpen();
        const value = query.trim();
        if (value.length === 0)
            return [];
        const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
        return this.notes.list({ query: value, limit: Math.min(500, boundedLimit * 3) })
            .filter(node => node.kind !== 'folder')
            .slice(0, boundedLimit);
    }
    async listKnowledgeNoteReferences(knowledgeId) {
        this.assertOpen();
        const entry = await this.get(knowledgeId);
        if (entry === undefined)
            throw notFound('knowledge entry', knowledgeId);
        const rows = this.db.prepare(`
      SELECT knowledge_id,note_id,source,source_session_id,created_at
      FROM knowledge_note_references
      WHERE knowledge_id=?
      ORDER BY created_at,note_id
    `).all(knowledgeId);
        return rows.flatMap(row => {
            const note = this.notes.get(String(row.note_id));
            if (note === undefined || note.kind === 'folder')
                return [];
            return [{
                    knowledgeId: entry.id,
                    knowledgeBaseId: entry.knowledgeBaseId,
                    documentTitle: entry.title,
                    note,
                    source: String(row.source),
                    ...row.source_session_id == null ? {} : { sourceSessionId: String(row.source_session_id) },
                    createdAt: String(row.created_at),
                }];
        });
    }
    async addKnowledgeNoteReference(knowledgeId, noteId, source, sourceSessionId) {
        this.assertOpen();
        const entry = await this.get(knowledgeId);
        if (entry === undefined)
            throw notFound('knowledge entry', knowledgeId);
        if (entry.status !== 'active')
            throw conflict('archived knowledge documents cannot change note references');
        if (entry.documentState !== 'open')
            throw finalizedConflict(entry);
        const note = this.notes.get(noteId);
        if (note === undefined)
            throw notFound('note node', noteId);
        if (note.kind === 'folder')
            throw inputError('knowledge documents can reference note documents or files, not folders');
        if (source !== 'user' && source !== 'agent' && source !== 'legacy')
            throw inputError('invalid knowledge note reference source');
        const sessionId = sourceSessionId?.trim() || undefined;
        if (sessionId !== undefined && sessionId.length > 200)
            throw inputError('reference source session id is too long');
        const createdAt = nowIso();
        this.db.prepare(`
      INSERT OR IGNORE INTO knowledge_note_references(knowledge_id,note_id,source,source_session_id,created_at)
      VALUES(?,?,?,?,?)
    `).run(entry.id, note.id, source, sessionId ?? null, createdAt);
        const reference = (await this.listKnowledgeNoteReferences(entry.id)).find(item => item.note.id === note.id);
        if (reference === undefined)
            throw new Error('knowledge note reference was not persisted');
        return reference;
    }
    async deleteKnowledgeNoteReference(knowledgeId, noteId) {
        this.assertOpen();
        const entry = await this.get(knowledgeId);
        if (entry === undefined)
            throw notFound('knowledge entry', knowledgeId);
        if (entry.status !== 'active')
            throw conflict('archived knowledge documents cannot change note references');
        if (entry.documentState !== 'open')
            throw finalizedConflict(entry);
        const result = this.db.prepare('DELETE FROM knowledge_note_references WHERE knowledge_id=? AND note_id=?').run(knowledgeId, noteId);
        if (result.changes === 0)
            throw notFound('knowledge note reference', `${knowledgeId}/${noteId}`);
    }
    noteReferencesForNotes(noteIds) {
        this.assertOpen();
        const ids = [...new Set(noteIds)];
        if (ids.length === 0)
            return [];
        const placeholders = ids.map(() => '?').join(',');
        return this.db.prepare(`
      SELECT r.note_id,e.knowledge_base_id,e.id AS document_id,e.title AS document_title
      FROM knowledge_note_references r
      JOIN knowledge_entries e ON e.id=r.knowledge_id
      WHERE r.note_id IN (${placeholders})
      ORDER BY e.updated_at DESC,e.id
    `).all(...ids).map(row => ({
            noteId: String(row.note_id),
            knowledgeBaseId: String(row.knowledge_base_id),
            documentId: String(row.document_id),
            documentTitle: String(row.document_title),
        }));
    }
    /** Compatibility path for manually embedded legacy note:// markers. */
    legacyNoteReferencesForNotes(noteIds) {
        this.assertOpen();
        const requested = new Set(noteIds.map(id => id.toLocaleLowerCase()));
        if (requested.size === 0)
            return [];
        const rows = this.db.prepare(`
      SELECT knowledge_base_id,id,title,content
      FROM knowledge_documents
      WHERE content LIKE '%note://note_%'
      ORDER BY updated_at DESC,id
    `).all();
        return rows.flatMap(row => {
            const references = String(row.content).match(/note:\/\/(note_[a-f0-9]{32})/giu) ?? [];
            return [...new Set(references.map(value => value.slice('note://'.length).toLocaleLowerCase()))]
                .filter(noteId => requested.has(noteId))
                .map(noteId => ({
                noteId,
                knowledgeBaseId: String(row.knowledge_base_id),
                documentId: String(row.id),
                documentTitle: String(row.title),
            }));
        });
    }
    deleteNoteReferences(noteIds) {
        this.assertOpen();
        const ids = [...new Set(noteIds)];
        if (ids.length === 0)
            return;
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM knowledge_note_references WHERE note_id IN (${placeholders})`).run(...ids);
    }
    async propose(input, sourceKey) {
        this.assertOpen();
        const proposal = normalizeProposal(input);
        const finalized = this.finalizedMatch(proposal);
        if (finalized !== undefined)
            throw finalizedConflict(finalized);
        return this.insertCandidate(proposal, sourceKey);
    }
    async writeDirect(input, sourceKey) {
        this.assertOpen();
        await this.documentsReady;
        let touchedEntryId;
        const normalized = normalizeProposal(input);
        const requestHash = createHash('sha256').update(JSON.stringify([
            contentHash(normalized.draft), normalized.action, normalized.targetId ?? '', normalized.change ?? null,
        ])).digest('hex');
        const result = this.transaction(() => {
            if (sourceKey !== undefined) {
                const receipt = this.db.prepare('SELECT result_json FROM writeback_receipts WHERE source_key=? AND proposal_hash=?').get(sourceKey, requestHash);
                if (receipt) {
                    const previous = JSON.parse(String(receipt.result_json));
                    touchedEntryId = previous.entry?.id;
                    return previous;
                }
            }
            const resolution = this.resolveDirectProposal(normalized);
            if (resolution.outcome === 'duplicate')
                return { outcome: 'duplicate', ...resolution.entry === undefined ? {} : { entry: resolution.entry } };
            if (resolution.outcome === 'finalized')
                return { outcome: 'finalized', entry: resolution.entry };
            const candidate = this.insertCandidate(resolution.proposal, sourceKey);
            if (candidate.status !== 'pending')
                return { outcome: 'duplicate', candidate };
            if (resolution.outcome === 'conflict') {
                const pending = { outcome: 'conflict', candidate };
                if (sourceKey !== undefined)
                    this.db.prepare('INSERT INTO writeback_receipts VALUES(?,?,?)').run(sourceKey, requestHash, JSON.stringify(pending));
                return pending;
            }
            const entry = resolution.proposal.action === 'create'
                ? this.insertEntry(resolution.proposal.draft)
                : resolution.proposal.change?.kind === 'finalize'
                    ? this.finalizeEntry(resolution.proposal.targetId, resolution.proposal.change.state, resolution.proposal.change.note)
                    : this.updateEntry(resolution.proposal.targetId, resolution.proposal.draft, 'update');
            const reviewedAt = nowIso();
            this.db.prepare('UPDATE knowledge_candidates SET status=?, reviewed_at=?, review_note=? WHERE id=?')
                .run('approved', reviewedAt, resolution.outcome === 'merged'
                ? 'Automatically merged by direct-write reconciliation.'
                : 'Automatically approved by direct-write policy.', candidate.id);
            touchedEntryId = entry.id;
            const committed = {
                outcome: resolution.outcome,
                candidate: {
                    ...candidate,
                    status: 'approved',
                    reviewedAt,
                    reviewNote: resolution.outcome === 'merged'
                        ? 'Automatically merged by direct-write reconciliation.'
                        : 'Automatically approved by direct-write policy.',
                },
                entry,
            };
            if (sourceKey !== undefined)
                this.db.prepare('INSERT INTO writeback_receipts VALUES(?,?,?)').run(sourceKey, requestHash, JSON.stringify(committed));
            return committed;
        });
        if (touchedEntryId !== undefined)
            await this.syncKnowledgeEntryQueued(touchedEntryId);
        return result;
    }
    insertCandidate(proposal, sourceKey) {
        const hash = contentHash(proposal.draft) + `:${proposal.action}:${proposal.targetId ?? ''}:${JSON.stringify(proposal.change ?? null)}`;
        if (sourceKey !== undefined) {
            const existing = this.db.prepare('SELECT * FROM knowledge_candidates WHERE source_key = ? AND proposal_hash = ?').get(sourceKey, hash);
            if (existing !== undefined)
                return rowToCandidate(existing);
        }
        const candidate = {
            ...proposal,
            id: newId(),
            status: 'pending',
            ...sourceKey === undefined ? {} : { sourceKey },
            createdAt: nowIso(),
        };
        this.db.prepare(`
      INSERT INTO knowledge_candidates(id,action,target_id,change_json,draft_json,reason,status,source_key,proposal_hash,created_at)
      VALUES(?,?,?,?,?,?,'pending',?,?,?)
    `).run(candidate.id, candidate.action, candidate.targetId ?? null, candidate.change === undefined ? null : JSON.stringify(candidate.change), JSON.stringify(candidate.draft), candidate.reason, sourceKey ?? null, hash, candidate.createdAt);
        return candidate;
    }
    resolveDirectProposal(proposal) {
        if (proposal.action === 'conflict')
            return { outcome: 'conflict', proposal };
        if (proposal.action === 'update') {
            const target = this.activeEntry(proposal.targetId);
            if (target.documentState !== 'open')
                return { outcome: 'finalized', entry: target };
            if (target.knowledgeBaseId !== proposal.draft.knowledgeBaseId) {
                throw conflict('direct-write update cannot move knowledge between knowledge bases');
            }
            if (!sameScope(target.scope, proposal.draft.scope)) {
                return { outcome: 'conflict', proposal: { ...proposal, action: 'conflict' } };
            }
            const applied = applyCandidateToTarget(target, proposal, true);
            if (!applied.ok) {
                return { outcome: 'conflict', proposal: { ...proposal, action: 'conflict' } };
            }
            const draft = applied.draft;
            if (proposal.change?.kind !== 'finalize' && contentHash(draft) === contentHash(target))
                return { outcome: 'duplicate', entry: target };
            return { outcome: 'merged', proposal: { ...proposal, action: 'update', draft } };
        }
        const entries = this.activeEntriesForDraft(proposal.draft);
        const bodyMatch = entries.find(entry => normalizedBody(entry.body) === normalizedBody(proposal.draft.body));
        const titleMatch = entries.find(entry => normalizedTitle(entry.title) === normalizedTitle(proposal.draft.title));
        const referenceMatch = entries.find(entry => sharesCanonicalTopicReference(entry, proposal.draft));
        const target = bodyMatch ?? titleMatch ?? referenceMatch;
        if (target === undefined)
            return { outcome: 'created', proposal };
        if (target.documentState !== 'open')
            return { outcome: 'finalized', entry: target };
        if (potentiallyConflicts(target, proposal.draft)) {
            return {
                outcome: 'conflict',
                proposal: { ...proposal, action: 'conflict', targetId: target.id },
            };
        }
        const draft = mergeKnowledgeDraft(target, proposal.draft, false);
        if (contentHash(draft) === contentHash(target))
            return { outcome: 'duplicate', entry: target };
        return {
            outcome: 'merged',
            proposal: { ...proposal, action: 'update', targetId: target.id, draft },
        };
    }
    finalizedMatch(proposal) {
        if (proposal.action !== 'create') {
            const target = this.activeEntry(proposal.targetId);
            return target.documentState === 'open' ? undefined : target;
        }
        const entries = this.activeEntriesForDraft(proposal.draft);
        return entries.find(entry => entry.documentState !== 'open' && (normalizedBody(entry.body) === normalizedBody(proposal.draft.body)
            || normalizedTitle(entry.title) === normalizedTitle(proposal.draft.title)
            || sharesCanonicalTopicReference(entry, proposal.draft)));
    }
    activeEntry(id) {
        const row = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id=? AND status='active'`).get(id);
        if (row === undefined)
            throw notFound('active knowledge entry', id);
        return rowToEntry(row);
    }
    activeEntriesForDraft(draft) {
        const scopeId = draft.scope.kind === 'project' ? draft.scope.id : null;
        return this.db.prepare(`
      SELECT ${ENTRY_COLUMNS} FROM knowledge_entries
      WHERE status='active' AND knowledge_base_id=? AND scope_kind=?
        AND ((scope_id IS NULL AND ? IS NULL) OR scope_id=?)
      ORDER BY updated_at DESC
    `).all(draft.knowledgeBaseId, draft.scope.kind, scopeId, scopeId).map(rowToEntry);
    }
    async listCandidates(status, limit) {
        this.assertOpen();
        return this.db.prepare('SELECT * FROM knowledge_candidates WHERE status = ? ORDER BY created_at DESC LIMIT ?')
            .all(status, Math.max(1, Math.min(limit, 100))).map(rowToCandidate).map(candidate => {
            if (candidate.status !== 'pending' || candidate.targetId === undefined || candidate.change?.kind !== 'revise')
                return candidate;
            try {
                const applied = applyCandidateToTarget(this.activeEntry(candidate.targetId), candidate, true);
                return applied.ok ? { ...candidate, draft: applied.draft } : candidate;
            }
            catch {
                return candidate;
            }
        });
    }
    async review(id, decision) {
        this.assertOpen();
        await this.documentsReady;
        let touchedEntryId;
        const reviewed = this.transaction(() => {
            const row = this.db.prepare('SELECT * FROM knowledge_candidates WHERE id = ?').get(id);
            if (row === undefined)
                throw notFound('knowledge candidate', id);
            const candidate = rowToCandidate(row);
            if (candidate.status !== 'pending')
                throw conflict(`candidate ${id} was already ${candidate.status}`);
            let draft = decision.draft === undefined ? candidate.draft : normalizeDraft(decision.draft);
            if (decision.decision === 'approve') {
                if (candidate.change?.kind === 'finalize') {
                    if (decision.draft !== undefined)
                        throw conflict('结束候选不能替换正文，请拒绝后重新提交');
                    const target = this.activeEntry(candidate.targetId);
                    assertExpectedReviewVersion(target, decision.expectedVersion);
                    const applied = applyCandidateToTarget(target, candidate, false);
                    if (!applied.ok)
                        throw conflict(`${applied.reason}；请拒绝过期的结束候选并重新确认`);
                    touchedEntryId = this.finalizeEntry(target.id, candidate.change.state, candidate.change.note).id;
                }
                else if (candidate.action !== 'create' && decision.draft !== undefined) {
                    if (candidate.action === 'conflict' && decision.resolution !== 'merge') {
                        throw conflict('conflict candidate requires an explicit merge resolution');
                    }
                    if (candidate.targetId === undefined)
                        throw new Error('candidate target is missing');
                    const target = this.activeEntry(candidate.targetId);
                    if (draft.knowledgeBaseId !== target.knowledgeBaseId) {
                        throw conflict('candidate approval cannot move a document between knowledge bases');
                    }
                    assertExpectedReviewVersion(target, decision.expectedVersion);
                    touchedEntryId = this.updateEntry(candidate.targetId, editedKnowledgeDraft(target, draft), 'update').id;
                }
                else if (candidate.action === 'conflict') {
                    if (decision.resolution !== 'merge') {
                        throw conflict('conflict candidate requires an explicit merge resolution');
                    }
                    if (candidate.targetId === undefined)
                        throw new Error('candidate target is missing');
                    const target = this.activeEntry(candidate.targetId);
                    if (draft.knowledgeBaseId !== target.knowledgeBaseId) {
                        throw conflict('candidate approval cannot move a document between knowledge bases');
                    }
                    const applied = applyCandidateToTarget(target, candidate, true);
                    if (!applied.ok)
                        throw conflict(`${applied.reason}; edit the current document to resolve this conflict`);
                    touchedEntryId = this.updateEntry(candidate.targetId, applied.draft, 'update').id;
                }
                else {
                    const resolution = this.resolveDirectProposal({
                        action: candidate.action,
                        ...candidate.targetId === undefined ? {} : { targetId: candidate.targetId },
                        ...candidate.change === undefined ? {} : { change: candidate.change },
                        draft,
                        reason: candidate.reason,
                    });
                    if (resolution.outcome === 'conflict') {
                        const proposal = resolution.proposal;
                        this.db.prepare(`
              UPDATE knowledge_candidates
              SET action='conflict', target_id=?, change_json=?, draft_json=?, reason=?
              WHERE id=? AND status='pending'
            `).run(proposal.targetId ?? null, proposal.change === undefined ? null : JSON.stringify(proposal.change), JSON.stringify(proposal.draft), proposal.reason, id);
                        return {
                            ...candidate,
                            action: 'conflict',
                            ...proposal.targetId === undefined ? {} : { targetId: proposal.targetId },
                            draft: proposal.draft,
                            reason: proposal.reason,
                        };
                    }
                    if (resolution.outcome === 'finalized')
                        throw finalizedConflict(resolution.entry);
                    if (resolution.outcome !== 'duplicate') {
                        const entry = resolution.proposal.action === 'create'
                            ? this.insertEntry(resolution.proposal.draft)
                            : this.updateEntry(resolution.proposal.targetId, resolution.proposal.draft, 'update');
                        touchedEntryId = entry.id;
                    }
                }
            }
            const status = decision.decision === 'approve' ? 'approved' : 'rejected';
            const reviewedAt = nowIso();
            const note = decision.note?.trim().slice(0, 2000);
            this.db.prepare('UPDATE knowledge_candidates SET status=?, reviewed_at=?, review_note=? WHERE id=?')
                .run(status, reviewedAt, note ?? null, id);
            return { ...candidate, status, reviewedAt, ...note === undefined ? {} : { reviewNote: note } };
        });
        if (touchedEntryId !== undefined)
            await this.syncKnowledgeEntryQueued(touchedEntryId);
        return reviewed;
    }
    async approvePendingBatch(limit, excludeIds = []) {
        this.assertOpen();
        const previous = this.batchReviewTail;
        let release;
        this.batchReviewTail = new Promise(resolve => { release = resolve; });
        await previous;
        try {
            await this.documentsReady;
            const batchLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
            const excluded = [...new Set(excludeIds.filter(id => typeof id === 'string' && id.length > 0))].slice(0, 5000);
            const exclusionSql = excluded.length === 0 ? '' : ` AND id NOT IN (${excluded.map(() => '?').join(',')})`;
            const selected = this.db.prepare(`
        SELECT id FROM knowledge_candidates
        WHERE status='pending' AND action<>'conflict'${exclusionSql}
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `).all(...excluded, batchLimit).map(row => String(row.id));
            let approved = 0;
            let deferred = 0;
            const failed = [];
            for (const id of selected) {
                try {
                    const reviewed = await this.review(id, { decision: 'approve' });
                    if (reviewed.status === 'approved')
                        approved += 1;
                    else if (reviewed.status === 'pending' && reviewed.action === 'conflict')
                        deferred += 1;
                    else
                        failed.push({ id, error: `candidate remained ${reviewed.status}` });
                }
                catch (error) {
                    failed.push({ id, error: error instanceof Error ? error.message : String(error) });
                }
            }
            const remainingExcluded = [...new Set([...excluded, ...failed.map(item => item.id)])];
            const remainingExclusionSql = remainingExcluded.length === 0
                ? ''
                : ` AND id NOT IN (${remainingExcluded.map(() => '?').join(',')})`;
            const remainingReviewable = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_candidates
        WHERE status='pending' AND action<>'conflict'${remainingExclusionSql}
      `).get(...remainingExcluded).count ?? 0);
            const pendingTotal = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge_candidates WHERE status='pending'
      `).get().count ?? 0);
            return {
                selected: selected.length,
                approved,
                deferred,
                failed,
                remainingReviewable,
                remainingManual: Math.max(0, pendingTotal - remainingReviewable),
            };
        }
        finally {
            release();
        }
    }
    async claimExtraction(sourceKey) {
        this.assertOpen();
        const claimedAt = nowIso();
        const staleBefore = new Date(Date.now() - EXTRACTION_LEASE_MS).toISOString();
        const result = this.db.prepare(`
      INSERT INTO extraction_jobs(source_key,status,attempts,candidate_count,updated_at)
      VALUES(?,'running',1,0,?)
      ON CONFLICT(source_key) DO UPDATE SET
        status='running', attempts=extraction_jobs.attempts+1, candidate_count=0,
        last_error=NULL, completion_json=NULL, updated_at=excluded.updated_at
      WHERE (
        (extraction_jobs.status='failed' AND extraction_jobs.attempts < 3)
        OR (extraction_jobs.status='running' AND extraction_jobs.updated_at < ?)
      )
    `).run(sourceKey, claimedAt, staleBefore);
        return result.changes === 1;
    }
    async completeExtraction(sourceKey, value) {
        this.assertOpen();
        const completion = normalizeExtractionCompletion(value);
        const result = this.db.prepare(`
      UPDATE extraction_jobs SET status='completed', candidate_count=?, last_error=NULL, completion_json=?, updated_at=?
      WHERE source_key=? AND status='running'
    `).run(completion.candidateCount, JSON.stringify(completion), nowIso(), sourceKey);
        if (result.changes === 0) {
            const current = await this.extractionJob(sourceKey);
            if (current?.status !== 'completed')
                throw conflict(`extraction job "${sourceKey}" is not running`);
        }
    }
    async failExtraction(sourceKey, error) {
        this.assertOpen();
        const result = this.db.prepare(`
      UPDATE extraction_jobs SET status='failed', last_error=?, updated_at=?
      WHERE source_key=? AND status='running'
    `).run(error.slice(0, 4000), nowIso(), sourceKey);
        if (result.changes === 0) {
            const current = await this.extractionJob(sourceKey);
            if (current?.status !== 'failed')
                throw conflict(`extraction job "${sourceKey}" is not running`);
        }
    }
    async resetExtraction(sourceKey) {
        this.assertOpen();
        this.db.prepare(`UPDATE extraction_jobs SET status='failed', attempts=0, candidate_count=0, last_error=NULL, completion_json=NULL, updated_at=? WHERE source_key=?`)
            .run(nowIso(), sourceKey);
    }
    async extractionJob(sourceKey) {
        this.assertOpen();
        const row = this.db.prepare('SELECT * FROM extraction_jobs WHERE source_key = ?').get(sourceKey);
        return row === undefined ? undefined : rowToExtractionJob(row);
    }
    ensureBootstrapToken(token) {
        this.assertOpen();
        const value = token.trim();
        if (value.length < 24)
            throw new Error('knowledge API token must contain at least 24 characters');
        const hash = tokenHash(value);
        const existing = this.db.prepare('SELECT id FROM api_tokens WHERE token_hash = ?').get(hash);
        if (existing !== undefined)
            return;
        this.db.prepare(`INSERT INTO api_tokens(id,name,token_hash,permissions_json,created_at) VALUES(?,?,?,?,?)`)
            .run(newId(), 'bootstrap-admin', hash, JSON.stringify(['read', 'propose', 'write', 'admin']), nowIso());
    }
    authenticate(token) {
        this.assertOpen();
        const row = this.db.prepare('SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL')
            .get(tokenHash(token));
        if (row === undefined)
            return undefined;
        const previous = row.last_used_at == null ? undefined : String(row.last_used_at);
        const now = Date.now();
        const shouldRefresh = previous === undefined || !Number.isFinite(Date.parse(previous)) || now - Date.parse(previous) >= 60_000;
        if (!shouldRefresh)
            return rowToToken(row);
        const usedAt = new Date(now).toISOString();
        this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(usedAt, String(row.id));
        return rowToToken({ ...row, last_used_at: usedAt });
    }
    createApiToken(name, permissions) {
        this.assertOpen();
        const cleanName = name.trim();
        if (cleanName.length === 0 || cleanName.length > 100)
            throw new Error('token name must contain 1-100 characters');
        const allowed = new Set(['read', 'propose', 'write', 'admin']);
        const normalized = [...new Set(permissions)];
        if (normalized.length === 0 || normalized.some(permission => !allowed.has(permission))) {
            throw new Error('token permissions must contain read, propose, write, or admin');
        }
        const token = `dshk_${randomBytes(32).toString('base64url')}`;
        const record = { id: newId(), name: cleanName, permissions: normalized, createdAt: nowIso() };
        this.db.prepare(`INSERT INTO api_tokens(id,name,token_hash,permissions_json,created_at) VALUES(?,?,?,?,?)`)
            .run(record.id, record.name, tokenHash(token), JSON.stringify(record.permissions), record.createdAt);
        return { record, token };
    }
    listApiTokens() {
        this.assertOpen();
        return this.db.prepare('SELECT * FROM api_tokens ORDER BY created_at DESC').all().map(rowToToken);
    }
    revokeApiToken(id) {
        this.assertOpen();
        const result = this.db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id);
        if (result.changes === 0)
            throw notFound('API token', id);
    }
    deleteApiToken(id) {
        this.assertOpen();
        const row = this.db.prepare('SELECT revoked_at FROM api_tokens WHERE id = ?').get(id);
        if (row === undefined)
            throw notFound('API token', id);
        if (row.revoked_at === null)
            throw conflict('only revoked API tokens can be deleted');
        this.db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id);
    }
    async close() {
        if (this.closed)
            return;
        await this.documentsReady;
        this.closed = true;
        this.db.close();
        await this.notes.close();
    }
    writeVersion(entry, changeKind) {
        const snapshot = {
            knowledgeBaseId: entry.knowledgeBaseId,
            title: entry.title,
            body: entry.body,
            type: entry.type,
            tags: entry.tags,
            scope: entry.scope,
            confidence: entry.confidence,
            ...entry.source === undefined ? {} : { source: entry.source },
            status: entry.status,
            documentState: entry.documentState,
            ...entry.finalizedAt === undefined ? {} : { finalizedAt: entry.finalizedAt },
            ...entry.finalizationNote === undefined ? {} : { finalizationNote: entry.finalizationNote },
        };
        this.db.prepare(`INSERT INTO knowledge_versions(id,knowledge_id,version,snapshot_json,change_kind,created_at) VALUES(?,?,?,?,?,?)`)
            .run(newId(), entry.id, entry.version, JSON.stringify(snapshot), changeKind, nowIso());
    }
    upsertFts(entry) {
        this.db.prepare('DELETE FROM knowledge_fts WHERE knowledge_id = ?').run(entry.id);
        if (entry.status === 'active') {
            this.db.prepare('INSERT INTO knowledge_fts(knowledge_id,title,body,tags) VALUES(?,?,?,?)')
                .run(entry.id, entry.title, entry.body, entry.tags.join(' '));
        }
    }
    async syncAllDocuments() {
        await this.documentStore.initialize();
        const bases = this.db.prepare('SELECT id FROM knowledge_bases').all();
        for (const base of bases)
            await this.syncKnowledgeDocuments(String(base.id));
    }
    enqueueDocumentSync(operation) {
        return enqueueDocumentProjection(this.documentStore.root, operation);
    }
    syncKnowledgeDocumentsQueued(knowledgeBaseId) {
        return this.enqueueDocumentSync(() => this.syncKnowledgeDocuments(knowledgeBaseId));
    }
    syncKnowledgeBaseManifestQueued(knowledgeBaseId) {
        return this.enqueueDocumentSync(async () => {
            const row = this.db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(knowledgeBaseId);
            if (row !== undefined)
                await this.documentStore.ensureBase(rowToKnowledgeBase(row));
        });
    }
    syncKnowledgeEntryQueued(entryId) {
        return this.enqueueDocumentSync(() => this.syncKnowledgeEntry(entryId));
    }
    /** Keep the derived Markdown projection proportional to one changed entry. */
    async syncKnowledgeEntry(entryId) {
        const projected = this.db.prepare(`
      SELECT id,knowledge_base_id,rel_path FROM knowledge_documents WHERE id=?
    `).get(entryId);
        const entryRow = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM knowledge_entries WHERE id=?`).get(entryId);
        if (entryRow === undefined || entryRow.status !== 'active') {
            if (projected !== undefined)
                await this.removeProjectedDocument(projected);
            this.db.prepare('DELETE FROM knowledge_documents WHERE id=?').run(entryId);
            return;
        }
        const entry = rowToEntry(entryRow);
        const baseRow = this.db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(entry.knowledgeBaseId);
        if (baseRow === undefined)
            return;
        const base = rowToKnowledgeBase(baseRow);
        const directory = await this.documentStore.ensureBase(base);
        const relPath = knowledgeDocumentPath(entry);
        const markdown = renderEntryMarkdown(entry);
        const stored = await this.documentStore.writeDocument(directory, relPath, markdown);
        this.upsertProjectedDocument(entry, relPath, stored.contentHash);
        if (projected !== undefined && (String(projected.knowledge_base_id) !== entry.knowledgeBaseId
            || String(projected.rel_path) !== relPath))
            await this.removeProjectedDocument(projected);
    }
    async removeProjectedDocument(projected) {
        const baseRow = this.db.prepare('SELECT * FROM knowledge_bases WHERE id=?')
            .get(String(projected.knowledge_base_id));
        if (baseRow === undefined)
            return;
        const directory = this.documentStore.baseDirectory(rowToKnowledgeBase(baseRow));
        try {
            await this.documentStore.deleteDocument(directory, String(projected.rel_path));
        }
        catch (error) {
            if (!(error instanceof Error && error.code === 'ENOENT'))
                throw error;
        }
    }
    upsertProjectedDocument(entry, relPath, projectedHash) {
        this.db.prepare(`
      INSERT INTO knowledge_documents(
        id,knowledge_base_id,rel_path,title,content,entry_count,content_hash,
        document_state,finalized_at,finalization_note,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        knowledge_base_id=excluded.knowledge_base_id,rel_path=excluded.rel_path,
        title=excluded.title,content=excluded.content,entry_count=excluded.entry_count,
        content_hash=excluded.content_hash,document_state=excluded.document_state,
        finalized_at=excluded.finalized_at,finalization_note=excluded.finalization_note,
        updated_at=excluded.updated_at
      WHERE knowledge_documents.knowledge_base_id<>excluded.knowledge_base_id
         OR knowledge_documents.content_hash<>excluded.content_hash
         OR knowledge_documents.rel_path<>excluded.rel_path
         OR knowledge_documents.title<>excluded.title
         OR knowledge_documents.entry_count<>excluded.entry_count
         OR knowledge_documents.document_state<>excluded.document_state
         OR knowledge_documents.finalized_at IS NOT excluded.finalized_at
         OR knowledge_documents.finalization_note IS NOT excluded.finalization_note
    `).run(entry.id, entry.knowledgeBaseId, relPath, entry.title, renderEntryContent(entry), 1, projectedHash, entry.documentState, entry.finalizedAt ?? null, entry.finalizationNote ?? null, entry.createdAt, entry.updatedAt);
    }
    async syncKnowledgeDocuments(knowledgeBaseId) {
        const baseRow = this.db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(knowledgeBaseId);
        if (baseRow === undefined)
            return;
        const base = rowToKnowledgeBase(baseRow);
        const directory = await this.documentStore.ensureBase(base);
        const storedDocuments = await this.documentStore.listDocuments(directory);
        const storedById = new Map(storedDocuments.map(document => [document.metadata.id, document]));
        const entries = this.db.prepare(`
      SELECT ${ENTRY_COLUMNS} FROM knowledge_entries
      WHERE knowledge_base_id=? AND status='active'
      ORDER BY updated_at DESC, id
    `).all(knowledgeBaseId).map(rowToEntry);
        const desired = new Map();
        for (const entry of entries) {
            const relPath = knowledgeDocumentPath(entry);
            const markdown = renderEntryMarkdown(entry);
            const current = storedById.get(entry.id);
            const contentHash = markdownHash(markdown);
            const stored = current?.relPath === relPath && current.contentHash === contentHash
                ? current
                : await this.documentStore.writeDocument(directory, relPath, markdown);
            desired.set(entry.id, {
                entry,
                relPath,
                contentHash: stored.contentHash,
            });
        }
        for (const document of storedDocuments) {
            const expected = desired.get(document.metadata.id);
            if (expected === undefined || expected.relPath !== document.relPath) {
                await this.documentStore.deleteDocument(directory, document.relPath, document.contentHash);
            }
        }
        const existing = this.db.prepare('SELECT id FROM knowledge_documents WHERE knowledge_base_id=?')
            .all(knowledgeBaseId);
        for (const document of desired.values()) {
            this.upsertProjectedDocument(document.entry, document.relPath, document.contentHash);
        }
        for (const row of existing) {
            if (!desired.has(String(row.id)))
                this.db.prepare('DELETE FROM knowledge_documents WHERE id=?').run(String(row.id));
        }
    }
}
function renderEntryMarkdown(entry) {
    return renderKnowledgeMarkdown({
        metadata: {
            id: entry.id,
            type: entry.type,
            tags: entry.tags,
            scope: entry.scope,
            confidence: entry.confidence,
            status: entry.status,
            documentState: entry.documentState,
            ...entry.finalizedAt === undefined ? {} : { finalizedAt: entry.finalizedAt },
            ...entry.finalizationNote === undefined ? {} : { finalizationNote: entry.finalizationNote },
        },
        title: entry.title,
        body: entry.body,
    });
}
function renderEntryContent(entry) {
    return `# ${markdownHeading(entry.title)}\n\n${entry.body.trim()}\n`;
}
function markdownHeading(value) {
    return value.replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim();
}
function rowToEntry(row) {
    const source = row.source_json == null ? undefined : JSON.parse(String(row.source_json));
    return {
        id: String(row.id),
        knowledgeBaseId: row.knowledge_base_id == null ? DEFAULT_KNOWLEDGE_BASE_ID : String(row.knowledge_base_id),
        title: String(row.title),
        body: String(row.body),
        type: String(row.type),
        tags: JSON.parse(String(row.tags_json)),
        scope: String(row.scope_kind) === 'global'
            ? { kind: 'global' }
            : { kind: 'project', id: String(row.scope_id) },
        confidence: Number(row.confidence),
        status: String(row.status),
        documentState: row.document_state == null ? 'open' : String(row.document_state),
        ...row.finalized_at == null ? {} : { finalizedAt: String(row.finalized_at) },
        ...row.finalization_note == null ? {} : { finalizationNote: String(row.finalization_note) },
        version: Number(row.version),
        ...source === undefined ? {} : { source },
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}
function originalFilenameFromRow(row) {
    if (row.entry_source_json == null)
        return {};
    try {
        const source = JSON.parse(String(row.entry_source_json));
        if (source?.kind === 'imported-file' && typeof source.filename === 'string' && source.filename.trim())
            return { originalFilename: source.filename.trim() };
    }
    catch {
        return {};
    }
    return {};
}
function rowToDocument(row) {
    return {
        id: String(row.id),
        knowledgeBaseId: String(row.knowledge_base_id),
        relPath: String(row.rel_path),
        title: String(row.title),
        content: String(row.content),
        entryCount: Number(row.entry_count),
        contentHash: String(row.content_hash),
        documentState: row.document_state == null ? 'open' : String(row.document_state),
        ...row.finalized_at == null ? {} : { finalizedAt: String(row.finalized_at) },
        ...row.finalization_note == null ? {} : { finalizationNote: String(row.finalization_note) },
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        ...originalFilenameFromRow(row),
    };
}
function rowToDocumentSummary(row) {
    return {
        id: String(row.id),
        knowledgeBaseId: String(row.knowledge_base_id),
        relPath: String(row.rel_path),
        title: String(row.title),
        entryCount: Number(row.entry_count),
        contentHash: String(row.content_hash),
        documentState: row.document_state == null ? 'open' : String(row.document_state),
        ...row.finalized_at == null ? {} : { finalizedAt: String(row.finalized_at) },
        ...row.finalization_note == null ? {} : { finalizationNote: String(row.finalization_note) },
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        ...originalFilenameFromRow(row),
    };
}
function rowToVersion(row) {
    const snapshot = JSON.parse(String(row.snapshot_json));
    if (snapshot.knowledgeBaseId === undefined)
        snapshot.knowledgeBaseId = DEFAULT_KNOWLEDGE_BASE_ID;
    if (snapshot.documentState === undefined)
        snapshot.documentState = 'open';
    return {
        id: String(row.id),
        knowledgeId: String(row.knowledge_id),
        version: Number(row.version),
        snapshot,
        changeKind: String(row.change_kind),
        createdAt: String(row.created_at),
    };
}
function rowToCandidate(row) {
    const targetId = row.target_id == null ? undefined : String(row.target_id);
    const sourceKey = row.source_key == null ? undefined : String(row.source_key);
    const reviewedAt = row.reviewed_at == null ? undefined : String(row.reviewed_at);
    const reviewNote = row.review_note == null ? undefined : String(row.review_note);
    const draft = JSON.parse(String(row.draft_json));
    const change = row.change_json == null ? undefined : normalizeCandidateChange(JSON.parse(String(row.change_json)));
    if (draft.knowledgeBaseId === undefined)
        draft.knowledgeBaseId = DEFAULT_KNOWLEDGE_BASE_ID;
    return {
        id: String(row.id),
        action: String(row.action),
        ...targetId === undefined ? {} : { targetId },
        ...change === undefined ? {} : { change },
        draft,
        reason: String(row.reason),
        status: String(row.status),
        ...sourceKey === undefined ? {} : { sourceKey },
        createdAt: String(row.created_at),
        ...reviewedAt === undefined ? {} : { reviewedAt },
        ...reviewNote === undefined ? {} : { reviewNote },
    };
}
function normalizeProposal(input) {
    const change = normalizeCandidateChange(input.change);
    const proposal = {
        action: input.action,
        ...input.targetId === undefined ? {} : { targetId: input.targetId },
        ...change === undefined ? {} : { change },
        draft: normalizeDraft(input.draft),
        reason: input.reason.trim().slice(0, 2000),
    };
    if (proposal.action !== 'create' && proposal.targetId === undefined) {
        throw new Error(`${proposal.action} candidate requires targetId`);
    }
    if (proposal.action === 'create' && proposal.change !== undefined) {
        throw new Error('create candidate cannot contain a document change');
    }
    return proposal;
}
function normalizeCandidateChange(input) {
    if (input === undefined)
        return undefined;
    if (input.kind === 'append')
        return { kind: 'append' };
    if (input.kind === 'finalize')
        return normalizeFinalizationChange(input);
    if (input.kind !== 'revise')
        throw new Error('unsupported candidate change kind');
    if (!Number.isSafeInteger(input.baseVersion) || input.baseVersion < 1) {
        throw new Error('revision baseVersion must be a positive integer');
    }
    const baseHash = input.baseHash.trim().toLocaleLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(baseHash))
        throw new Error('revision baseHash must be a SHA-256 hash');
    if (!Array.isArray(input.edits) || input.edits.length < 1 || input.edits.length > 20) {
        throw new Error('revision must contain 1-20 text edits');
    }
    const edits = input.edits.map((edit, index) => {
        const oldText = edit.oldText.replace(/\r\n?/gu, '\n');
        const newText = edit.newText.replace(/\r\n?/gu, '\n');
        if (oldText.length === 0 || oldText.length > 12_000)
            throw new Error(`revision edit ${index + 1} anchor must contain 1-12000 characters`);
        if (newText.length > 12_000)
            throw new Error(`revision edit ${index + 1} replacement must contain at most 12000 characters`);
        return { oldText, newText };
    });
    const append = input.append?.trim();
    if (append !== undefined && append.length > 12_000)
        throw new Error('revision append must contain at most 12000 characters');
    return { kind: 'revise', baseVersion: input.baseVersion, baseHash, edits, ...append ? { append } : {} };
}
function mergeKnowledgeDraft(current, incoming, preferIncomingTitle) {
    return normalizeDraft({
        knowledgeBaseId: current.knowledgeBaseId,
        title: preferIncomingTitle ? incoming.title : current.title,
        body: mergeKnowledgeBodies(current.body, incoming.body),
        type: current.type,
        tags: [...current.tags, ...incoming.tags],
        scope: current.scope,
        confidence: Math.max(current.confidence, incoming.confidence),
        ...incoming.source === undefined
            ? current.source === undefined ? {} : { source: current.source }
            : { source: incoming.source },
    });
}
function applyCandidateToTarget(current, proposal, preferIncomingTitle) {
    if (proposal.change?.kind === 'finalize') {
        if (current.documentState !== 'open' || current.version !== proposal.change.baseVersion || contentHash(current) !== proposal.change.baseHash
            || current.knowledgeBaseId !== proposal.draft.knowledgeBaseId || contentHash(current) !== contentHash(proposal.draft)) {
            return { ok: false, reason: '文档或结束范围已变化，不能封存未核验的新内容' };
        }
        return { ok: true, draft: proposal.draft };
    }
    if (proposal.change?.kind !== 'revise') {
        if (potentiallyConflicts(current, proposal.draft))
            return { ok: false, reason: 'candidate contradicts the current document' };
        return { ok: true, draft: mergeKnowledgeDraft(current, proposal.draft, preferIncomingTitle) };
    }
    const revised = applyKnowledgeTextEdits(current.body, proposal.change.edits, proposal.change.append);
    if (!revised.ok)
        return revised;
    return {
        ok: true,
        draft: normalizeDraft({
            knowledgeBaseId: current.knowledgeBaseId,
            title: preferIncomingTitle ? proposal.draft.title : current.title,
            body: revised.body,
            type: current.type,
            tags: [...current.tags, ...proposal.draft.tags],
            scope: current.scope,
            confidence: Math.max(current.confidence, proposal.draft.confidence),
            ...proposal.draft.source === undefined
                ? current.source === undefined ? {} : { source: current.source }
                : { source: proposal.draft.source },
        }),
    };
}
function editedKnowledgeDraft(current, incoming) {
    return normalizeDraft({
        ...incoming,
        knowledgeBaseId: current.knowledgeBaseId,
        type: current.type,
        scope: current.scope,
    });
}
function assertExpectedReviewVersion(current, expectedVersion) {
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
        throw conflict(`knowledge changed during review (expected version ${expectedVersion}, current version ${current.version}); reopen the editor and resolve the current document`);
    }
}
function potentiallyConflicts(current, incoming) {
    const currentBody = normalizedBody(current.body);
    const incomingBody = normalizedBody(incoming.body);
    if (currentBody === incomingBody || currentBody.includes(incomingBody) || incomingBody.includes(currentBody))
        return false;
    if (addsDistinctMarkdownSections(current.body, incoming.body))
        return false;
    const overlap = termOverlap(currentBody, incomingBody);
    if (overlap < 0.35)
        return false;
    const currentPolarity = polarity(currentBody);
    const incomingPolarity = polarity(incomingBody);
    if (currentPolarity !== 0 && incomingPolarity !== 0 && currentPolarity !== incomingPolarity)
        return true;
    const currentValues = factualValues(currentBody);
    const incomingValues = factualValues(incomingBody);
    return currentValues.length > 0 && incomingValues.length > 0
        && !currentValues.some(value => incomingValues.includes(value));
}
function addsDistinctMarkdownSections(current, incoming) {
    const currentHeadings = markdownHeadings(current);
    const incomingHeadings = markdownHeadings(incoming);
    if (currentHeadings.size === 0 || incomingHeadings.size === 0)
        return false;
    return [...incomingHeadings].every(heading => !currentHeadings.has(heading));
}
function markdownHeadings(value) {
    return new Set([...value.matchAll(/^#{1,6}\s+(.+)$/gmu)]
        .map(match => normalizedTitle(match[1] ?? ''))
        .filter(Boolean));
}
function normalizedTitle(value) {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}
function normalizedBody(value) {
    return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}
function sharesCanonicalTopicReference(current, incoming) {
    const currentReferences = canonicalTopicReferences(`${current.title}\n${current.body}`);
    if (currentReferences.size === 0)
        return false;
    return [...canonicalTopicReferences(`${incoming.title}\n${incoming.body}`)]
        .some(reference => currentReferences.has(reference));
}
function canonicalTopicReferences(value) {
    const references = new Set();
    for (const match of value.matchAll(/https?:\/\/(?:www\.)?github\.com\/([^\s/?#]+)\/([^\s/?#]+)/giu)) {
        const owner = match[1]?.toLocaleLowerCase();
        const repository = match[2]?.replace(/\.git$/iu, '').replace(/[.,，。;；:：!?！？]+$/u, '').toLocaleLowerCase();
        if (owner && repository)
            references.add(`github:${owner}/${repository}`);
    }
    return references;
}
function sameScope(left, right) {
    return left.kind === right.kind && (left.kind === 'global' || left.id === right.id);
}
function semanticTerms(value) {
    const terms = new Set(value.match(/[a-z0-9][a-z0-9_.:/-]*/giu)?.map(term => term.toLocaleLowerCase()) ?? []);
    for (const sequence of value.match(/\p{Script=Han}+/gu) ?? []) {
        const chars = [...sequence];
        for (let index = 0; index < chars.length - 1; index += 1)
            terms.add(`${chars[index]}${chars[index + 1]}`);
    }
    return terms;
}
function termOverlap(left, right) {
    const leftTerms = semanticTerms(left);
    const rightTerms = semanticTerms(right);
    const denominator = Math.min(leftTerms.size, rightTerms.size);
    if (denominator === 0)
        return 0;
    let common = 0;
    for (const term of leftTerms)
        if (rightTerms.has(term))
            common += 1;
    return common / denominator;
}
function polarity(value) {
    const positive = /(?:\b(?:enable|enabled|allow|allowed|true|yes|must|should|use)\b|启用|允许|必须|应该|可以|使用)/iu.test(value);
    const negative = /(?:\b(?:disable|disabled|deny|denied|false|no|never|must not|should not|do not|don't)\b|禁用|禁止|不得|不应|不可以|不要|不能|关闭|无需)/iu.test(value);
    return positive === negative ? 0 : positive ? 1 : -1;
}
function factualValues(value) {
    return [...new Set(value.match(/\b(?:v?\d+(?:\.\d+){0,3}|true|false|enabled|disabled)\b/giu)?.map(item => item.toLocaleLowerCase()) ?? [])];
}
function rowToKnowledgeBase(row) {
    const writebackProvider = row.writeback_provider == null ? undefined : String(row.writeback_provider);
    const writebackModel = row.writeback_model == null ? undefined : String(row.writeback_model);
    return {
        id: String(row.id),
        name: String(row.name),
        ...(row.group_name ? { group: String(row.group_name) } : {}),
        description: String(row.description),
        defaultTags: JSON.parse(String(row.default_tags_json)),
        extractionInstructions: String(row.extraction_instructions),
        writebackPolicy: String(row.writeback_policy),
        ...writebackProvider === undefined || writebackModel === undefined ? {} : { writebackProvider, writebackModel },
        status: String(row.status),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}
function rowToMount(row) {
    return {
        id: String(row.id),
        targetKind: String(row.target_kind),
        targetId: String(row.target_id),
        knowledgeBaseId: String(row.knowledge_base_id),
        enabled: Number(row.enabled) === 1,
        recallEnabled: Number(row.recall_enabled) === 1,
        writeMode: String(row.write_mode),
        includeTags: JSON.parse(String(row.include_tags_json)),
        excludeTags: JSON.parse(String(row.exclude_tags_json)),
        extractionInstructions: String(row.extraction_instructions),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}
function rowToExtractionJob(row) {
    const lastError = row.last_error == null ? undefined : String(row.last_error);
    const completion = row.completion_json == null
        ? undefined
        : normalizeExtractionCompletion(JSON.parse(String(row.completion_json)));
    return {
        sourceKey: String(row.source_key),
        status: String(row.status),
        attempts: Number(row.attempts),
        candidateCount: Number(row.candidate_count),
        ...lastError === undefined ? {} : { lastError },
        ...completion === undefined ? {} : { completion },
        updatedAt: String(row.updated_at),
    };
}
function normalizeExtractionCompletion(value) {
    if (typeof value === 'number') {
        const candidateCount = Math.max(0, Math.floor(value));
        return { outcome: 'completed', candidateCount, directCount: 0, auditCount: candidateCount, destinations: [] };
    }
    if (value.outcome !== 'completed' && value.outcome !== 'skipped' && value.outcome !== 'unmounted') {
        throw new Error('extraction completion outcome is invalid');
    }
    const count = (input, field) => {
        if (!Number.isInteger(input) || input < 0 || input > 10_000)
            throw new Error(`extraction completion ${field} is invalid`);
        return input;
    };
    if (!Array.isArray(value.destinations) || value.destinations.length > 100) {
        throw new Error('extraction completion destinations are invalid');
    }
    const text = (input, field, limit) => {
        const normalized = typeof input === 'string' ? input.trim() : '';
        if (normalized.length === 0 || normalized.length > limit)
            throw new Error(`extraction completion ${field} is invalid`);
        return normalized;
    };
    return {
        outcome: value.outcome,
        candidateCount: count(value.candidateCount, 'candidateCount'),
        directCount: count(value.directCount, 'directCount'),
        auditCount: count(value.auditCount, 'auditCount'),
        destinations: value.destinations.map(destination => {
            if (destination.disposition !== 'written' && destination.disposition !== 'pending-review') {
                throw new Error('extraction completion disposition is invalid');
            }
            return {
                knowledgeBaseId: text(destination.knowledgeBaseId, 'knowledgeBaseId', 200),
                knowledgeBaseName: text(destination.knowledgeBaseName, 'knowledgeBaseName', 200),
                ...destination.documentId === undefined ? {} : { documentId: text(destination.documentId, 'documentId', 200) },
                documentTitle: text(destination.documentTitle, 'documentTitle', 500),
                ...destination.documentPath === undefined ? {} : { documentPath: text(destination.documentPath, 'documentPath', 1000) },
                disposition: destination.disposition,
                ...destination.documentState === 'resolved' || destination.documentState === 'complete' ? { documentState: destination.documentState } : {},
            };
        }),
    };
}
function rowToToken(row) {
    const lastUsedAt = row.last_used_at == null ? undefined : String(row.last_used_at);
    const revokedAt = row.revoked_at == null ? undefined : String(row.revoked_at);
    return {
        id: String(row.id),
        name: String(row.name),
        permissions: JSON.parse(String(row.permissions_json)),
        createdAt: String(row.created_at),
        ...lastUsedAt === undefined ? {} : { lastUsedAt },
        ...revokedAt === undefined ? {} : { revokedAt },
    };
}
function tokenHash(token) {
    return createHash('sha256').update(token).digest('hex');
}
function toFtsQuery(text) {
    const terms = text.split(/\s+/u).map(term => term.trim()).filter(Boolean).slice(0, 20);
    return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(' OR ');
}
function fallbackTerms(text) {
    const terms = new Set();
    for (const word of text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{1,}/g) ?? [])
        terms.add(word);
    for (const sequence of text.match(/\p{Script=Han}+/gu) ?? []) {
        const chars = [...sequence];
        if (chars.length === 1)
            terms.add(chars[0]);
        for (let index = 0; index < chars.length - 1; index += 1) {
            terms.add(`${chars[index]}${chars[index + 1]}`);
        }
    }
    return [...terms].slice(0, 20);
}
function relevanceScore(entry, query) {
    const normalizedQuery = normalizedBody(query);
    if (normalizedQuery.length === 0)
        return 1;
    const title = normalizedBody(entry.title);
    const body = normalizedBody(entry.body);
    const tags = normalizedBody(entry.tags.join(' '));
    const combined = `${title}\n${body}\n${tags}`;
    if (combined.includes(normalizedQuery))
        return .98;
    const terms = fallbackTerms(query).filter(term => !SEARCH_STOP_TERMS.has(term));
    if (terms.length === 0)
        return .25;
    const coverage = terms.filter(term => combined.includes(term)).length / terms.length;
    const titleCoverage = terms.filter(term => title.includes(term)).length / terms.length;
    const tagCoverage = terms.filter(term => tags.includes(term)).length / terms.length;
    return Math.min(.97, .05 + coverage * .72 + titleCoverage * .13 + tagCoverage * .1);
}
const SEARCH_STOP_TERMS = new Set([
    'a', 'an', 'and', 'are', 'for', 'how', 'is', 'of', 'or', 'the', 'to', 'what', 'when', 'where', 'which', 'who', 'why',
    '什么', '么是', '如何', '怎么', '是否', '介绍',
]);
function encodeCursor(updatedAt, id) {
    return Buffer.from(JSON.stringify({ updatedAt, id })).toString('base64url');
}
function decodeCursor(cursor) {
    try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof value.updatedAt !== 'string' || typeof value.id !== 'string')
            throw new Error();
        return { updatedAt: value.updatedAt, id: value.id };
    }
    catch {
        throw Object.assign(new Error('invalid pagination cursor'), { code: 'BAD_REQUEST' });
    }
}
function encodeDocumentCursor(knowledgeBaseId, sortRank, relPath, id) {
    return Buffer.from(JSON.stringify({ knowledgeBaseId, sortRank, relPath, id })).toString('base64url');
}
function decodeDocumentCursor(cursor) {
    try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof value.knowledgeBaseId !== 'string'
            || (value.sortRank !== 0 && value.sortRank !== 1)
            || typeof value.relPath !== 'string'
            || typeof value.id !== 'string')
            throw new Error();
        return {
            knowledgeBaseId: value.knowledgeBaseId,
            sortRank: value.sortRank,
            relPath: value.relPath,
            id: value.id,
        };
    }
    catch {
        throw Object.assign(new Error('invalid document pagination cursor'), { code: 'BAD_REQUEST', status: 400 });
    }
}
function escapeSqlLike(value) {
    return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
function notFound(kind, id) {
    return Object.assign(new Error(`${kind} "${id}" was not found`), { code: 'NOT_FOUND' });
}
function conflict(message) {
    return Object.assign(new Error(message), { code: 'CONFLICT' });
}
function inputError(message) {
    return Object.assign(new Error(message), { code: 'BAD_REQUEST', status: 400 });
}
function finalizedConflict(entry) {
    const label = entry.documentState === 'resolved' ? 'resolved' : 'collection complete';
    return conflict(`knowledge document "${entry.title}" (${entry.id}) is finalized as ${label}; reopen it before making changes`);
}
function normalizeFinalizationNote(value) {
    const note = value?.trim();
    if (!note)
        return undefined;
    if (note.length > 1000)
        throw new Error('finalization note must contain at most 1000 characters');
    return note;
}
//# sourceMappingURL=local-provider.js.map