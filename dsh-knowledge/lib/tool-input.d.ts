import type { AgentLike, ToolRunContextLike } from './runtime.js';
export declare function requireToolAgent(exec: ToolRunContextLike, family?: string): AgentLike;
export declare function toolRecord(value: unknown): Record<string, unknown>;
export declare function requiredToolString(value: unknown, name: string, maxLength: number): string;
export declare function optionalToolInteger(value: unknown, name: string, min: number, max: number): number | undefined;
//# sourceMappingURL=tool-input.d.ts.map