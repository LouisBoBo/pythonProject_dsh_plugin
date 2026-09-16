import type { ExtractionWriteDestination } from '../domain.js';
import type { ExtractionCheckpoint, TurnSnapshot } from '../extraction.js';
export interface WritebackStatus {
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    summary: string;
    error?: string;
    retryable: boolean;
    destinations?: ExtractionWriteDestination[];
    nextAttemptAt?: number;
    blockedBy?: string;
    cancelRequested?: boolean;
}
export interface WritebackWork {
    snapshot: TurnSnapshot;
    destination: string;
}
export declare class WritebackDeferred extends Error {
}
/** Local durable outbox. No network/LLM work runs on enqueue or manual retry. */
export declare class WritebackQueue {
    private readonly execute;
    private readonly warn;
    private readonly db;
    private readonly owner;
    private timer;
    private active;
    private controller;
    private activeKey;
    private closed;
    private closing;
    private readonly listeners;
    subscribe(listener: () => void): () => void;
    get revision(): string;
    private notify;
    constructor(path: string, execute: (work: WritebackWork, checkpoint: ExtractionCheckpoint, signal: AbortSignal) => Promise<WritebackStatus>, warn?: (message: string) => void);
    enqueue(work: WritebackWork): WritebackStatus;
    completeEmpty(sourceKey: string, sessionId: string): WritebackStatus;
    status(key: string): WritebackStatus | undefined;
    retry(key: string): WritebackStatus;
    list(sessionId?: string, offset?: number, limit?: number, status?: WritebackStatus['status']): {
        total: number;
        items: {
            status: "queued" | "running" | "completed" | "failed" | "cancelled";
            summary: string;
            error?: string;
            retryable: boolean;
            destinations?: ExtractionWriteDestination[];
            nextAttemptAt?: number;
            blockedBy?: string;
            cancelRequested?: boolean;
            sourceKey: string;
            sessionId: string;
            attempts: number;
            createdAt: number | null;
        }[];
    };
    cancel(key: string): WritebackStatus;
    private finishCancellation;
    start(): void;
    get isRunning(): boolean;
    private kick;
    private claim;
    private drain;
    close(): Promise<void>;
}
//# sourceMappingURL=queue.d.ts.map