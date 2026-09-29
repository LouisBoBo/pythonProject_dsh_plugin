import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { Config as ConfigSchema, type Config as KnowledgeConfig } from './config.js';
export declare const Config: Schema<ConfigSchema>;
export type Config = KnowledgeConfig;
export * from './domain.js';
export * from './provider.js';
export * from './notes/domain.js';
export { LocalKnowledgeProvider } from './local-provider.js';
export { RemoteKnowledgeProvider, RemoteProviderError } from './remote-provider.js';
/** Human-readable Cordis plugin name. */
export declare const name = "dsh-knowledge";
/** Extraction and native retrieval tools require the corresponding DSH host services. */
export declare const inject: string[];
/** Mount storage, hybrid retrieval, extraction, and the optional authenticated HTTP API. */
export declare function apply(ctx: Context, config: KnowledgeConfig): void;
//# sourceMappingURL=index.d.ts.map