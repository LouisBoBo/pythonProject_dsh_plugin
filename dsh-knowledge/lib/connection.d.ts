import type { ResolvedConfig } from './config.js';
import type { KnowledgeProvider } from './provider.js';
export interface KnowledgeConnectionSettings {
    backend: 'local' | 'remote';
    remoteUrl?: string;
    remoteToken?: string;
    remoteTimeoutMs: number;
}
export declare function connectionSettingsBase(config: ResolvedConfig): KnowledgeConnectionSettings;
export declare function validateConnectionSettings(settings: KnowledgeConnectionSettings, exposeApi: boolean, localDatabaseAvailable?: boolean): void;
export declare function createConnectionProvider(config: ResolvedConfig, settings: KnowledgeConnectionSettings, publicApiEnabled?: boolean): KnowledgeProvider;
export declare function sameConnection(left: KnowledgeConnectionSettings, right: KnowledgeConnectionSettings): boolean;
export declare function loadStoredConnection(path: string | undefined): KnowledgeConnectionSettings | undefined;
export declare function storeConnection(path: string, settings: KnowledgeConnectionSettings): Promise<void>;
//# sourceMappingURL=connection.d.ts.map