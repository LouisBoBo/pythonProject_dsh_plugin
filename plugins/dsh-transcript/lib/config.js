import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
    enabled: Schema.boolean().default(true).description('是否在每轮结束时把该轮写入本机归档'),
    archiveRoot: Schema.string().description('归档根目录绝对路径；默认由宿主 dshHomePath(\'transcripts\') 注入'),
});
export function dshHome() {
    const fromEnv = process.env.DSH_HOME?.trim();
    return fromEnv || join(homedir(), '.dsh');
}
/** 绝对路径按宿主注入值使用。相对路径落在 DSH 家目录下，避免写进当前工程。 */
export function resolveConfig(config) {
    const enabled = config?.enabled !== false;
    const raw = String(config?.archiveRoot ?? '').trim();
    const archiveRoot = raw
        ? resolve(isAbsolute(raw) ? raw : join(dshHome(), raw))
        : join(dshHome(), 'transcripts');
    return { enabled, archiveRoot };
}
