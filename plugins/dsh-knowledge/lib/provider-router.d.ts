import type { KnowledgeProvider } from './provider.js';
/**
 * Stable provider identity for runtime consumers while settings switch the
 * underlying local/remote connection. Calls already in flight finish on the
 * provider they started with; retired providers close after their last call.
 */
export declare class KnowledgeProviderRouter {
    readonly provider: KnowledgeProvider;
    private current;
    private readonly states;
    private closing;
    private connectionRevision;
    get revision(): number;
    constructor(initial: KnowledgeProvider, options?: {
        owned?: boolean;
    });
    replace(next: KnowledgeProvider, options?: {
        owned?: boolean;
    }): Promise<void>;
    close(): Promise<void>;
    private state;
    private invoke;
    private closeWhenIdle;
}
//# sourceMappingURL=provider-router.d.ts.map