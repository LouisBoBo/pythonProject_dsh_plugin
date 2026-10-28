import { type SessionEvent } from './events.js';
export interface ArchiveInput {
    archiveRoot: string;
    sessionId: string;
    turn: unknown;
    events: readonly SessionEvent[];
    workspace?: string;
    now?: Date;
}
export type ArchiveResult = {
    ok: true;
    wrote: boolean;
    sessionDir?: string;
} | {
    ok: false;
    category: string;
};
export declare function archiveTurn(input: ArchiveInput): Promise<ArchiveResult>;
export declare function describeArchive(archiveRoot: string, sessionId: string | undefined): Promise<{
    path: string;
    pending: boolean;
}>;
export declare function sessionIdFromExec(exec: unknown): string;
