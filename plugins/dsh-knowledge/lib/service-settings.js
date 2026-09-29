import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { atomicWriteFile } from './atomic-file.js';
export function serviceSettingsPath(connectionPath) {
    return connectionPath === undefined ? undefined : `${connectionPath}.service.json`;
}
export function loadServiceSettings(path) {
    if (path === undefined)
        return undefined;
    let value;
    try {
        value = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw new Error(`failed to read knowledge service settings: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('stored knowledge service settings must be a JSON object');
    }
    const stored = value;
    const enabled = stored.publicApiEnabled;
    if (typeof enabled !== 'boolean')
        throw new Error('stored public API setting must be a boolean');
    const provider = typeof stored.writebackProvider === 'string' ? stored.writebackProvider.trim() : undefined;
    const model = typeof stored.writebackModel === 'string' ? stored.writebackModel.trim() : undefined;
    if ((provider === undefined) !== (model === undefined))
        throw new Error('stored client writeback provider and model must be configured together');
    return { publicApiEnabled: enabled, ...provider && model ? { writebackProvider: provider, writebackModel: model } : {} };
}
export async function storeServiceSettings(path, settings) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await atomicWriteFile(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}
//# sourceMappingURL=service-settings.js.map