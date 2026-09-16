import type { WritebackStatus } from './queue.js';
/** One cancellable request stream per visible turn; stale GETs cannot undo retries. */
export declare class WritebackStatusClient {
    private readonly url;
    private readonly change;
    private readonly fetcher;
    private request;
    private timer;
    private disposed;
    private visible;
    private retrying;
    private failures;
    private value;
    private readError;
    private missing;
    private invalidated;
    constructor(url: string, change: (value: WritebackStatus | undefined, retrying: boolean, readError?: string) => void, fetcher?: typeof fetch);
    setVisible(visible: boolean): void;
    refresh(): void;
    invalidate(): void;
    retry(): void;
    private load;
    dispose(): void;
}
//# sourceMappingURL=status-client.d.ts.map