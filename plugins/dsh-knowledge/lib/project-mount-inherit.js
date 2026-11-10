import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';

const SESSION_FILE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
const MAX_SESSION_FILES = 5000;
const MAX_SESSION_BYTES = 1024 * 1024;
const WRITE_MODES = new Set(['none', 'audit', 'direct']);

/**
 * 知识库文件在 dsh-home/knowledge/ 下时，返回 dsh-home。
 * 其它路径不猜会话目录，避免扫到无关磁盘。
 */
export function knowledgeHomeFromDatabasePath(databasePath) {
    if (typeof databasePath !== 'string' || databasePath.length === 0 || databasePath === ':memory:')
        return undefined;
    const knowledgeDir = dirname(databasePath);
    if (basename(knowledgeDir) !== 'knowledge')
        return undefined;
    return dirname(knowledgeDir);
}

/**
 * 从宿主会话投影里找出属于这个工作目录的会话 id。
 * 只读 record.identity.cwd，不读对话正文。目录缺失、越界或符号链接指向家目录外时 ok=false，调用方不要记“已继承”。
 */
export function sessionIdsForCwd(homeDir, cwd) {
    if (typeof homeDir !== 'string' || homeDir.length === 0)
        return { ok: false, ids: [] };
    if (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > 4096)
        return { ok: false, ids: [] };
    const expected = join(homeDir, 'storages', 'session_projcache', 'sessions');
    let homeReal;
    let root;
    try {
        homeReal = realpathSync(homeDir);
        root = realpathSync(expected);
    }
    catch {
        return { ok: false, ids: [] };
    }
    if (root !== join(homeReal, 'storages', 'session_projcache', 'sessions') && !root.startsWith(`${homeReal}${sep}`))
        return { ok: false, ids: [] };
    let names;
    try {
        names = readdirSync(root);
    }
    catch {
        return { ok: false, ids: [] };
    }
    const ids = [];
    let seen = 0;
    for (const name of names) {
        if (seen >= MAX_SESSION_FILES)
            break;
        if (!SESSION_FILE.test(name))
            continue;
        seen += 1;
        const file = join(root, name);
        let info;
        try {
            info = lstatSync(file);
        }
        catch {
            continue;
        }
        if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_SESSION_BYTES)
            continue;
        let parsed;
        try {
            parsed = JSON.parse(readFileSync(file, 'utf8'));
        }
        catch {
            continue;
        }
        if (parsed?.record?.identity?.cwd !== cwd)
            continue;
        ids.push(name.slice(0, -'.json'.length));
    }
    return { ok: true, ids };
}

/**
 * 同一工作目录里，取挂载行更新时间最新的那个会话，只复制其中 enabled 的库。
 * enabled=false 表示这个会话明确关掉，不能再抬成项目挂载。
 * targetId 由调用方填成项目路径。
 */
export function projectMountDraftsToAdopt(mounts, sessionIds) {
    if (!Array.isArray(mounts) || !Array.isArray(sessionIds) || sessionIds.length === 0)
        return [];
    const allowed = new Set(sessionIds.filter(id => typeof id === 'string' && id.length > 0));
    const rows = [];
    for (const mount of mounts) {
        if (!mount || mount.targetKind !== 'session' || !allowed.has(mount.targetId))
            continue;
        if (typeof mount.knowledgeBaseId !== 'string' || mount.knowledgeBaseId.length === 0)
            continue;
        if (!WRITE_MODES.has(mount.writeMode))
            continue;
        rows.push(mount);
    }
    if (rows.length === 0)
        return [];
    let bestId = '';
    let bestTs = '';
    for (const row of rows) {
        const ts = typeof row.updatedAt === 'string' ? row.updatedAt : '';
        if (bestId === '' || ts > bestTs || (ts === bestTs && row.targetId > bestId)) {
            bestTs = ts;
            bestId = row.targetId;
        }
    }
    const drafts = [];
    for (const row of rows) {
        if (row.targetId !== bestId || row.enabled !== true)
            continue;
        drafts.push({
            targetKind: 'project',
            knowledgeBaseId: row.knowledgeBaseId,
            enabled: true,
            recallEnabled: row.recallEnabled === true,
            writeMode: row.writeMode,
            includeTags: Array.isArray(row.includeTags) ? row.includeTags : [],
            excludeTags: Array.isArray(row.excludeTags) ? row.excludeTags : [],
            extractionInstructions: typeof row.extractionInstructions === 'string' ? row.extractionInstructions : '',
        });
    }
    return drafts;
}
