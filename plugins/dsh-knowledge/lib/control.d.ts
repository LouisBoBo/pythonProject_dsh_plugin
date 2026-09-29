import type { KnowledgeConnectionSettings } from './connection.js';
import type { RuntimeContextLike } from './runtime.js';
export declare const KNOWLEDGE_CONTROL_PATH = "/knowledge-control/v1/connection";
export interface KnowledgeConnectionView {
    backend: 'local' | 'remote';
    remoteUrl?: string;
    remoteTimeoutMs: number;
    tokenConfigured: boolean;
    canSwitchRemote: boolean;
    writable: boolean;
    managementAvailable: boolean;
    managementPath?: string;
}
export interface KnowledgeConnectionUpdate {
    backend: 'local' | 'remote';
    remoteUrl?: string;
    remoteToken?: string;
    remoteTimeoutMs: number;
}
export interface KnowledgeControlOptions {
    current(): KnowledgeConnectionSettings;
    canSwitchRemote: boolean | (() => boolean);
    writable: boolean;
    managementAvailable: boolean | (() => boolean);
    managementPath?: string;
    update(value: KnowledgeConnectionUpdate): Promise<KnowledgeConnectionSettings>;
}
/** Register the same-origin control surface used by the plugin settings card. */
export declare function registerKnowledgeControl(ctx: RuntimeContextLike, options: KnowledgeControlOptions): () => void;
//# sourceMappingURL=control.d.ts.map