import { randomUUID } from 'node:crypto';
import { open, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
/**
 * Durably replace one file without exposing partially written content.
 *
 * Windows cannot rename over an existing file and requires a writable handle
 * for FlushFileBuffers. POSIX uses the normal atomic rename + directory fsync
 * path. Callers own creation of the parent directory.
 */
export async function atomicWriteFile(target, content, options = {}) {
    const replace = options.replace ?? true;
    const synchronize = options.sync ?? true;
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, content, {
            flag: 'wx',
            mode: options.mode ?? 0o600,
        });
        if (synchronize)
            await syncFile(temporary);
        if (!replace)
            await reserveTarget(target);
        await replaceWithTemporary(temporary, target, replace);
        if (synchronize)
            await syncParentDirectory(target);
    }
    finally {
        await rm(temporary, { force: true }).catch(() => { });
    }
}
async function reserveTarget(target) {
    try {
        const handle = await open(target, 'wx', 0o600);
        await handle.close();
    }
    catch (error) {
        if (isNodeError(error, 'EEXIST'))
            throw conflict(`file ${basename(target)} already exists`);
        throw error;
    }
    await unlink(target);
}
async function replaceWithTemporary(temporary, target, replace) {
    try {
        await rename(temporary, target);
    }
    catch (error) {
        if (!isWindowsReplaceError(error, replace, process.platform))
            throw error;
        await unlink(target).catch(unlinkError => {
            if (!isNodeError(unlinkError, 'ENOENT'))
                throw unlinkError;
        });
        await rename(temporary, target);
    }
}
export function isWindowsReplaceError(error, replace, platform) {
    return replace
        && platform === 'win32'
        && (isNodeError(error, 'EPERM') || isNodeError(error, 'EEXIST'));
}
async function syncFile(path) {
    const handle = await open(path, 'r+');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
async function syncParentDirectory(target) {
    if (!supportsDirectorySync(process.platform))
        return;
    const handle = await open(dirname(target), 'r');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
export function supportsDirectorySync(platform) {
    return platform !== 'win32';
}
function conflict(message) {
    return Object.assign(new Error(message), { code: 'CONFLICT' });
}
function isNodeError(error, code) {
    return error instanceof Error && error.code === code;
}
//# sourceMappingURL=atomic-file.js.map