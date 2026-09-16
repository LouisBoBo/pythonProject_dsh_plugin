export interface AtomicWriteOptions {
    mode?: number;
    replace?: boolean;
    sync?: boolean;
}
/**
 * Durably replace one file without exposing partially written content.
 *
 * Windows cannot rename over an existing file and requires a writable handle
 * for FlushFileBuffers. POSIX uses the normal atomic rename + directory fsync
 * path. Callers own creation of the parent directory.
 */
export declare function atomicWriteFile(target: string, content: string | Uint8Array, options?: AtomicWriteOptions): Promise<void>;
export declare function isWindowsReplaceError(error: unknown, replace: boolean, platform: NodeJS.Platform): boolean;
export declare function supportsDirectorySync(platform: NodeJS.Platform): boolean;
//# sourceMappingURL=atomic-file.d.ts.map