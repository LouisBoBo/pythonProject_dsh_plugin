const WORKSPACE_ACTIVATE_EVENT = '@lemoncat7/dsh-plugin-ui/workspace-activate';
/** Claim the conversation workspace while remaining compatible with installed plugin versions. */
export function activatePluginWorkspace(pluginId) {
    window.dispatchEvent(new CustomEvent(WORKSPACE_ACTIVATE_EVENT, {
        detail: { pluginId },
    }));
}
/** Close this workspace when another plugin claims the conversation area. */
export function observePluginWorkspace(pluginId, close) {
    const onActivate = (event) => {
        const detail = event.detail;
        if (detail?.pluginId !== pluginId)
            close();
    };
    window.addEventListener(WORKSPACE_ACTIVATE_EVENT, onActivate);
    return () => window.removeEventListener(WORKSPACE_ACTIVATE_EVENT, onActivate);
}
//# sourceMappingURL=workspace-ownership.js.map