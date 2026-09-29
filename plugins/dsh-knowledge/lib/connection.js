import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicWriteFile } from './atomic-file.js';
import { LocalKnowledgeProvider } from './local-provider.js';
import { RemoteKnowledgeProvider } from './remote-provider.js';
import { normalizeRemoteKnowledgeUrl } from './remote-url.js';
export function connectionSettingsBase(config) {
    return {
        backend: config.backend,
        remoteTimeoutMs: config.remoteTimeoutMs,
        ...config.remoteUrl === undefined ? {} : { remoteUrl: config.remoteUrl },
        ...config.remoteToken === undefined ? {} : { remoteToken: config.remoteToken },
    };
}
export function validateConnectionSettings(settings, exposeApi, localDatabaseAvailable = true) {
    if (!Number.isInteger(settings.remoteTimeoutMs) || settings.remoteTimeoutMs < 100 || settings.remoteTimeoutMs > 120_000) {
        throw new Error('remote timeout must be an integer from 100 to 120000 milliseconds');
    }
    if (settings.backend === 'local') {
        if (!localDatabaseAvailable)
            throw new Error('local knowledge backend is unavailable because databasePath is not configured');
        return;
    }
    if (exposeApi)
        throw new Error('a central knowledge server cannot switch its own provider to remote mode');
    if (settings.remoteUrl === undefined || settings.remoteToken === undefined) {
        throw new Error('remote knowledge backend requires a server URL and client token');
    }
    normalizeRemoteKnowledgeUrl(settings.remoteUrl);
    if (settings.remoteToken.trim().length < 24)
        throw new Error('remote client token must contain at least 24 characters');
}
export function createConnectionProvider(config, settings, publicApiEnabled = config.exposeApi) {
    validateConnectionSettings(settings, publicApiEnabled, config.databasePath !== undefined && config.databasePath.trim().length > 0);
    return settings.backend === 'local'
        ? new LocalKnowledgeProvider(config.databasePath)
        : new RemoteKnowledgeProvider({
            url: settings.remoteUrl,
            token: settings.remoteToken,
            timeoutMs: settings.remoteTimeoutMs,
        });
}
export function sameConnection(left, right) {
    return left.backend === right.backend
        && left.remoteUrl === right.remoteUrl
        && left.remoteToken === right.remoteToken
        && left.remoteTimeoutMs === right.remoteTimeoutMs;
}
export function loadStoredConnection(path) {
    if (path === undefined)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw new Error(`failed to read knowledge connection settings: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed))
        throw new Error('stored knowledge connection settings must be a JSON object');
    if (parsed.backend !== 'local' && parsed.backend !== 'remote') {
        throw new Error('stored knowledge connection backend must be local or remote');
    }
    if (!Number.isInteger(parsed.remoteTimeoutMs)) {
        throw new Error('stored knowledge connection timeout must be an integer');
    }
    const settings = {
        backend: parsed.backend,
        remoteTimeoutMs: parsed.remoteTimeoutMs,
        ...typeof parsed.remoteUrl === 'string' ? { remoteUrl: parsed.remoteUrl } : {},
        ...typeof parsed.remoteToken === 'string' ? { remoteToken: parsed.remoteToken } : {},
    };
    return settings;
}
export async function storeConnection(path, settings) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await atomicWriteFile(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
//# sourceMappingURL=connection.js.map