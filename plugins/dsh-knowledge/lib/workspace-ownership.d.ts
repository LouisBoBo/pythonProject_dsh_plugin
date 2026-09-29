/** Claim the conversation workspace while remaining compatible with installed plugin versions. */
export declare function activatePluginWorkspace(pluginId: string): void;
/** Close this workspace when another plugin claims the conversation area. */
export declare function observePluginWorkspace(pluginId: string, close: () => void): () => void;
//# sourceMappingURL=workspace-ownership.d.ts.map