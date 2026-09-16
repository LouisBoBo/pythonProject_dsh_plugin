import type { AgentLike } from './runtime.js';
export type KnowledgeBaseManagementOperation = 'create' | 'update';
export type KnowledgeNoteReferenceOperation = 'inspect' | 'add' | 'remove';
export type KnowledgeNoteOperation = 'inspect' | 'create' | 'update' | 'move' | 'delete';
export type KnowledgeNoteTarget = 'any' | 'document' | 'folder';
/**
 * Knowledge-base management is a persistent control-plane mutation. Tool
 * descriptions help model routing, but the execution boundary independently
 * verifies that the current direct user turn requested this exact operation.
 */
export declare function assertExplicitKnowledgeBaseManagementRequest(agent: AgentLike, operation: KnowledgeBaseManagementOperation): void;
export declare function explicitlyRequestsKnowledgeBaseManagement(input: string, operation: KnowledgeBaseManagementOperation): boolean;
export declare function assertExplicitKnowledgeNoteReferenceRequest(agent: AgentLike, operation: KnowledgeNoteReferenceOperation): void;
export declare function assertExplicitKnowledgeNoteRequest(agent: AgentLike, operation: KnowledgeNoteOperation, target?: KnowledgeNoteTarget): void;
export declare function explicitlyRequestsKnowledgeNote(input: string, operation: KnowledgeNoteOperation, target?: KnowledgeNoteTarget): boolean;
export declare function currentDirectUserText(agent: AgentLike): string;
//# sourceMappingURL=tool-authorization.d.ts.map