export type SensitiveContentKind = 'private-key' | 'authorization-header' | 'cookie' | 'credential-assignment' | 'known-token-format' | 'embedded-url-credential';
export interface SensitiveContentFinding {
    kind: SensitiveContentKind;
}
/**
 * Deterministic last-line defence for automatic direct write-back. Findings
 * intentionally contain no matched value so logs and review metadata cannot
 * leak the credential a second time.
 */
export declare function inspectSensitiveContent(content: string): SensitiveContentFinding[];
export declare function containsSensitiveContent(content: string): boolean;
//# sourceMappingURL=content-safety.d.ts.map