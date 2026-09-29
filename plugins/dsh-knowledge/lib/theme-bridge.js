import { KNOWLEDGE_PALETTE } from './design-tokens.js';
export const KNOWLEDGE_THEME_MESSAGE = '@zhongruan/dsh-knowledge/host-theme';
export const KNOWLEDGE_THEME_READY_MESSAGE = '@zhongruan/dsh-knowledge/host-theme-ready';
export const KNOWLEDGE_THEME_PROTOCOL_VERSION = 1;
/**
 * The management console lives in its own iframe and therefore owns its
 * component palette.  Only the host colour scheme crosses that boundary.
 * Keeping these tokens stable prevents a branded host accent from changing
 * editor selection, navigation and dialog hierarchy independently.
 */
export function createKnowledgeHostTheme(snapshot) {
    return {
        type: KNOWLEDGE_THEME_MESSAGE,
        version: KNOWLEDGE_THEME_PROTOCOL_VERSION,
        colorScheme: snapshot.active.colorScheme,
        tokens: { ...KNOWLEDGE_PALETTE[snapshot.active.colorScheme] },
    };
}
//# sourceMappingURL=theme-bridge.js.map