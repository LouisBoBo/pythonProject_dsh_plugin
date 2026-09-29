window.__ModuleLoader__.load({ id: "@zhongruan/dsh-knowledge", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.tsx
var client_exports = {};
__export(client_exports, {
  apply: () => apply2,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var import_react6 = require("react");

// src/writeback/status-client.ts
var WritebackStatusClient = class {
  // Browser fetch checks its Window receiver. Never store it as an unbound
  // instance method: this.fetcher() would supply the client as its receiver.
  constructor(url, change, fetcher = (...args) => globalThis.fetch(...args)) {
    this.url = url;
    this.change = change;
    this.fetcher = fetcher;
  }
  request;
  timer;
  disposed = false;
  visible = true;
  retrying = false;
  failures = 0;
  value;
  readError;
  missing = false;
  invalidated = false;
  setVisible(visible) {
    this.visible = visible;
    if (visible) this.refresh();
    else {
      clearTimeout(this.timer);
      if (!this.retrying) this.request?.abort();
    }
  }
  refresh() {
    if (this.disposed || !this.visible || this.retrying || this.request && !this.request.signal.aborted) return;
    void this.load(false);
  }
  invalidate() {
    if (this.disposed || !this.visible) return;
    if (this.retrying || this.request && !this.request.signal.aborted) this.invalidated = true;
    else this.refresh();
  }
  retry() {
    if (this.disposed || this.retrying || !this.value?.retryable) return;
    this.retrying = true;
    this.request?.abort();
    this.change(this.value, true);
    void this.load(true);
  }
  async load(retry) {
    clearTimeout(this.timer);
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(new Error("\u72B6\u6001\u8BF7\u6C42\u8D85\u65F6")), 15e3);
    let delay = 15e3;
    try {
      const response = await this.fetcher(this.url, {
        method: retry ? "POST" : "GET",
        signal: controller.signal,
        headers: { accept: "application/json", "x-dsh-knowledge-client": "conversation-web" }
      });
      const body = await response.json();
      if (this.request !== controller || this.disposed) return;
      if (!response.ok && (retry || response.status !== 404 || String(body.status) !== "missing")) throw new Error(body.error ?? `\u72B6\u6001\u8BF7\u6C42\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
      if (response.ok && !body.summary) throw new Error("\u65E0\u6548\u7684\u56DE\u5199\u72B6\u6001\u54CD\u5E94");
      if (response.ok && body.summary) {
        this.readError = void 0;
        this.missing = false;
        this.value = body;
        this.failures = 0;
        delay = body.status === "completed" || body.status === "cancelled" ? 0 : body.status === "failed" ? 15e3 : 1500;
      } else {
        if (this.value || this.missing) {
          this.missing = true;
          this.value = void 0;
          this.readError = "\u5F53\u524D\u5BA2\u6237\u7AEF\u627E\u4E0D\u5230\u8FD9\u8F6E\u56DE\u5199\u8BB0\u5F55\uFF1B\u65E7\u7B49\u5F85\u72B6\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u56DE\u5199\u4EFB\u52A1\u4E2D\u6838\u5BF9\u3002";
        } else this.readError = void 0;
        delay = ++this.failures <= 3 ? 1500 : 6e4;
      }
    } catch (error) {
      if (this.request !== controller || this.disposed) return;
      delay = Math.min(6e4, 2e3 * 2 ** Math.min(5, this.failures++));
      if (retry && this.value) this.value = { ...this.value, error: error instanceof Error ? error.message : String(error) };
      else if (this.visible) this.readError = "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u56DE\u5199\u72B6\u6001\uFF0C\u6B63\u5728\u81EA\u52A8\u91CD\u8BD5\uFF1B\u8FD9\u4E0D\u4EE3\u8868\u56DE\u5199\u5931\u8D25\u3002";
    } finally {
      clearTimeout(timeout);
      if (this.request === controller && !this.disposed) {
        this.request = void 0;
        if (retry) this.retrying = false;
        this.change(this.value, this.retrying, this.readError);
        if (this.invalidated && this.visible) {
          this.invalidated = false;
          this.refresh();
        } else if (delay && this.visible) this.timer = setTimeout(() => this.refresh(), delay);
      }
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.request?.abort();
  }
};

// web/writeback-live.js
var groups = /* @__PURE__ */ new Map();
function subscribeWritebackChanges(client, listener) {
  let group = groups.get(client);
  if (!group) {
    let emit2 = function() {
      for (const fn of listeners) fn();
    }, resume2 = function() {
      clearTimeout(timer);
      request2?.abort();
      request2 = void 0;
      if (!document.hidden && !stopped) {
        emit2();
        void poll();
      }
    };
    var emit = emit2, resume = resume2;
    const listeners = /* @__PURE__ */ new Set();
    let stopped = false, request2, timer, revision = "", failures = 0;
    async function poll() {
      if (stopped || document.hidden) return;
      const controller = new AbortController();
      request2 = controller;
      try {
        const response = await fetch(`/knowledge-control/v1/writeback-changes?since=${encodeURIComponent(revision)}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { "x-dsh-knowledge-client": client },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25e3)])
        });
        if (!response.ok) throw new Error("notification transport unavailable");
        const data = await response.json();
        if (typeof data.revision !== "string") throw new Error("invalid revision");
        if (stopped || controller.signal.aborted) return;
        const changed = revision !== data.revision || failures > 0;
        revision = data.revision;
        failures = 0;
        if (changed) emit2();
      } catch {
        if (!controller.signal.aborted) failures++;
      } finally {
        if (request2 === controller) {
          request2 = void 0;
          if (!stopped && !document.hidden) timer = setTimeout(poll, failures ? Math.min(3e4, 1e3 * 2 ** Math.min(failures, 5)) : 0);
        }
      }
    }
    document.addEventListener("visibilitychange", resume2);
    window.addEventListener("online", resume2);
    group = { listeners, close() {
      stopped = true;
      clearTimeout(timer);
      request2?.abort();
      document.removeEventListener("visibilitychange", resume2);
      window.removeEventListener("online", resume2);
    } };
    groups.set(client, group);
    timer = setTimeout(poll, 0);
  }
  group.listeners.add(listener);
  return () => {
    group.listeners.delete(listener);
    if (!group.listeners.size) {
      group.close();
      groups.delete(client);
    }
  };
}

// src/workspace-ownership.ts
var WORKSPACE_ACTIVATE_EVENT = "@lemoncat7/dsh-plugin-ui/workspace-activate";
function activatePluginWorkspace(pluginId) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_ACTIVATE_EVENT, {
    detail: { pluginId }
  }));
}
function observePluginWorkspace(pluginId, close) {
  const onActivate = (event) => {
    const detail = event.detail;
    if (detail?.pluginId !== pluginId) close();
  };
  window.addEventListener(WORKSPACE_ACTIVATE_EVENT, onActivate);
  return () => window.removeEventListener(WORKSPACE_ACTIVATE_EVENT, onActivate);
}

// src/client.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/design-tokens.ts
var KNOWLEDGE_PALETTE = {
  light: {
    "--bg": "#ebebeb",
    "--surface": "#f4f4f4",
    "--surface-raised": "#fafafa",
    "--surface-soft": "#eeeeef",
    "--surface-hover": "rgb(118 118 128 / 9%)",
    "--dialog-surface": "#f4f4f4",
    "--menu-surface": "rgb(232 234 236 / 98%)",
    "--menu-surface-solid": "#e8eaec",
    "--document-surface": "rgb(218 222 226 / 32%)",
    "--selection-background": "#b8c8d6",
    "--selection-text": "#17212b",
    "--activity-surface": "rgba(255, 255, 255, 0.14)",
    "--text": "#1d1d1f",
    "--text-secondary": "#515154",
    "--text-tertiary": "#6e6e73",
    "--border": "rgb(60 60 67 / 14%)",
    "--border-strong": "rgb(60 60 67 / 24%)",
    "--accent": "#3a3a3c",
    "--accent-hover": "#1d1d1f",
    "--accent-soft": "#e2e2e5",
    "--on-accent": "#ffffff",
    "--success": "#248a3d",
    "--success-soft": "#e8f5eb",
    "--warning": "#c93400",
    "--warning-soft": "#fff1e8",
    "--danger": "#d70015",
    "--danger-soft": "#ffebed",
    "--shadow": "0 24px 64px rgb(0 0 0 / 20%)"
  },
  dark: {
    "--bg": "#101719",
    "--surface": "#182022",
    "--surface-raised": "#20292b",
    "--surface-soft": "rgb(184 204 205 / 6%)",
    "--surface-hover": "rgb(105 182 186 / 9%)",
    "--dialog-surface": "#20292b",
    "--menu-surface": "rgb(29 38 40 / 98%)",
    "--menu-surface-solid": "#1d2628",
    "--document-surface": "rgb(130 138 146 / 6%)",
    "--selection-background": "#455b68",
    "--selection-text": "#ffffff",
    "--activity-surface": "rgb(29 36 38 / 24%)",
    "--text": "#e3eaeb",
    "--text-secondary": "#bbc9cc",
    "--text-tertiary": "#95a7ab",
    "--border": "rgb(184 204 205 / 10%)",
    "--border-strong": "rgb(184 204 205 / 18%)",
    "--accent": "#69b6ba",
    "--accent-hover": "#8aced0",
    "--accent-soft": "rgb(105 182 186 / 13%)",
    "--on-accent": "#101819",
    "--success": "#30d158",
    "--success-soft": "rgb(48 209 88 / 13%)",
    "--warning": "#ff9f0a",
    "--warning-soft": "rgb(255 159 10 / 13%)",
    "--danger": "#ff453a",
    "--danger-soft": "rgb(255 69 58 / 14%)",
    "--shadow": "0 28px 72px rgb(0 0 0 / 42%)"
  }
};
var KNOWLEDGE_FONTS = {
  "--font-ui": 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", Arial, sans-serif',
  "--font-reading": "var(--font-ui)",
  "--font-mono": '"SFMono-Regular", "Cascadia Code", Menlo, Consolas, monospace'
};
var KNOWLEDGE_EMBEDDED_MATERIAL = {
  light: {
    "--knowledge-embedded-surface": "rgba(255, 255, 255, 0.08)",
    "--knowledge-embedded-filter": "saturate(.65) contrast(1.015) blur(24px)",
    "--knowledge-embedded-control": "rgba(255, 255, 255, 0.27)"
  },
  dark: {
    "--knowledge-embedded-surface": "rgb(16 23 25 / 18%)",
    "--knowledge-embedded-filter": "saturate(.55) contrast(1.02) blur(24px)",
    "--knowledge-embedded-control": "rgb(39 50 53 / 72%)"
  }
};
function declarations(tokens) {
  return Object.entries(tokens).map(([name, value]) => name + ":" + value + ";").join("");
}
function knowledgeDesignCss(scope = ":root", dark = ':root[data-color-scheme="dark"]', systemMode = true) {
  const themeTokens = (scheme) => declarations(KNOWLEDGE_PALETTE[scheme]) + declarations(KNOWLEDGE_EMBEDDED_MATERIAL[scheme]);
  const base = scope + "{" + declarations(KNOWLEDGE_FONTS) + themeTokens("light") + "}";
  const darkRule = dark + "{" + themeTokens("dark") + "}";
  const automatic = systemMode ? "@media(prefers-color-scheme:dark){" + scope + ":not([data-color-scheme]){" + themeTokens("dark") + "}}" : "";
  return base + automatic + darkRule;
}

// src/knowledge-activity-state.ts
function availableActivitySession(state, docked = false) {
  const current = state.current;
  if (current === void 0 || state.byId[current] === void 0) return void 0;
  return docked || state.byId[current]?.blank === false ? String(current) : void 0;
}
function mergeActivitySelection(previous, next) {
  const merged = { ...previous, ...next };
  if ("knowledgeBaseId" in next && next.knowledgeBaseId !== previous.knowledgeBaseId && !("documentId" in next)) {
    merged.documentId = void 0;
  }
  return merged;
}

// src/docked-panel-compat.tsx
var import_react = require("react");
function supportsDockedPanels(ctx) {
  return typeof ctx.layout.selectPanel === "function";
}
function createDockedPanel(ctx, id, title, render, notify) {
  const records = /* @__PURE__ */ new Map();
  let pending;
  let frame;
  let disposed = false;
  let sidebar;
  const cancel = () => {
    if (frame !== void 0) window.cancelAnimationFrame(frame);
    frame = void 0;
    pending = void 0;
  };
  function Body(props) {
    const { tab } = props.useTabInfo();
    const sessionId = String(props.sessionId);
    (0, import_react.useEffect)(() => {
      let entries2 = records.get(sessionId);
      if (entries2 === void 0) {
        entries2 = /* @__PURE__ */ new Map();
        records.set(sessionId, entries2);
      }
      const entry = { visible: tab.visible, close: () => tab.actions.close() };
      entries2.set(tab.id, entry);
      const remove = () => {
        if (entries2?.get(tab.id) !== entry) return;
        entries2.delete(tab.id);
        if (entries2.size === 0) records.delete(sessionId);
        notify();
      };
      tab.signal.addEventListener("abort", remove, { once: true });
      notify();
      return () => {
        tab.signal.removeEventListener("abort", remove);
        remove();
      };
    }, [sessionId, tab.id, tab.visible, tab.signal]);
    return tab.visible ? render(props) : null;
  }
  const fiber = ctx.inject(["sidebarRight", "sidebarRightTabs"], (child) => {
    sidebar = child.get("sidebarRight");
    const registry = child.get("sidebarRightTabs");
    const slots = child.slots;
    child.effect(() => registry.register({ id, kind: id, title: () => title }), id + ": tab type");
    child.effect(() => slots.inject("sidebar.right.pane.tab", () => slots.register({
      name: "sidebar.right.pane.tab",
      key: id
    }, Body)), id + ": tab body");
    child.effect(() => () => {
      sidebar = void 0;
    }, id + ": tab service");
  });
  return {
    open(sessionId) {
      cancel();
      pending = sessionId;
      let attempts = 0;
      const reveal = () => {
        frame = void 0;
        if (disposed || pending !== sessionId) return;
        const sessions = ctx.get("sessions");
        if (String(sessions.list.getSnapshot().current) !== sessionId) {
          cancel();
          notify();
          return;
        }
        try {
          if (sidebar === void 0) throw new Error("Right sidebar is not ready");
          sidebar.openTab(id);
          pending = void 0;
          notify();
        } catch (error) {
          if (++attempts < 30) frame = window.requestAnimationFrame(reveal);
          else {
            cancel();
            notify();
            console.error(title + ": could not open sidebar", error);
          }
        }
      };
      frame = window.requestAnimationFrame(reveal);
      notify();
    },
    close(sessionId) {
      if (pending === sessionId) cancel();
      for (const entry of [...records.get(sessionId)?.values() ?? []]) entry.close();
      records.delete(sessionId);
      notify();
    },
    isOpen(sessionId) {
      return pending === sessionId || [...records.get(sessionId)?.values() ?? []].some((entry) => entry.visible);
    },
    dispose() {
      disposed = true;
      cancel();
      for (const entries2 of records.values()) for (const entry of [...entries2.values()]) entry.close();
      records.clear();
      void fiber.dispose();
    }
  };
}

// src/client.css
var client_default = '.dsh-knowledge-trigger,\n.dsh-knowledge-activity-panel,\n.dsh-knowledge-workspace,\n.dsh-knowledge-settings-card,\n.dsh-knowledge-writeback-notice {\n  color-scheme: light;\n  --knowledge-canvas: transparent;\n  --knowledge-accent: var(--accent);\n  --knowledge-on-accent: var(--on-accent);\n  --knowledge-danger: var(--danger);\n  --knowledge-success: var(--success);\n  --knowledge-pane: rgba(255, 255, 255, 0.16);\n  --knowledge-raised: rgba(255, 255, 255, 0.38);\n  --knowledge-control: rgba(255, 255, 255, 0.27);\n  --knowledge-border: var(--border);\n  --knowledge-text: var(--text);\n  --knowledge-text-secondary: var(--text-secondary);\n  --knowledge-text-tertiary: var(--text-tertiary);\n  --knowledge-hover: var(--surface-hover);\n  --knowledge-glare-light: rgb(255 255 255 / 70%);\n  --knowledge-glare-rim: rgb(60 60 67 / 11%);\n  --knowledge-glass-filter: saturate(1.22) contrast(1.03) blur(32px);\n  --knowledge-host-glass-filter: saturate(.18) contrast(1.015) blur(24px);\n  --knowledge-glass-shadow: inset 0 1px 0 rgb(255 255 255 / 70%), inset 0 -1px 0 rgb(60 60 67 / 11%), 0 10px 28px rgb(31 31 35 / 8.5%);\n  --knowledge-font-family: var(--font-ui);\n  color: var(--knowledge-text);\n  font-family: var(--knowledge-font-family);\n  font-size: 13px;\n  line-height: 1.5;\n}\n\nbody[data-ds-dark-theme] :is(\n  .dsh-knowledge-trigger,\n  .dsh-knowledge-activity-panel,\n  .dsh-knowledge-workspace,\n  .dsh-knowledge-settings-card,\n  .dsh-knowledge-writeback-notice\n) {\n  color-scheme: dark;\n  --knowledge-canvas: transparent;\n  --knowledge-accent: var(--accent);\n  --knowledge-on-accent: var(--on-accent);\n  --knowledge-danger: var(--danger);\n  --knowledge-success: var(--success);\n  --knowledge-pane: rgb(25 33 35 / 90%);\n  --knowledge-raised: rgb(32 41 43 / 94%);\n  --knowledge-control: rgb(39 50 53 / 92%);\n  --knowledge-border: var(--border);\n  --knowledge-text: var(--text);\n  --knowledge-text-secondary: var(--text-secondary);\n  --knowledge-text-tertiary: var(--text-tertiary);\n  --knowledge-hover: var(--surface-hover);\n  --knowledge-glare-light: rgb(255 255 255 / 16%);\n  --knowledge-glare-rim: rgb(0 0 0 / 30%);\n  --knowledge-host-glass-filter: saturate(.45) contrast(1.02) blur(24px);\n  --knowledge-glass-shadow: inset 0 1px 0 rgb(255 255 255 / 16%), inset 0 -1px 0 rgb(0 0 0 / 30%), 0 12px 32px rgb(0 0 0 / 30%);\n}\n\n:is(\n  .dsh-knowledge-trigger,\n  .dsh-knowledge-activity-panel,\n  .dsh-knowledge-workspace,\n  .dsh-knowledge-settings-card,\n  .dsh-knowledge-writeback-notice\n),\n:is(\n  .dsh-knowledge-trigger,\n  .dsh-knowledge-activity-panel,\n  .dsh-knowledge-workspace,\n  .dsh-knowledge-settings-card,\n  .dsh-knowledge-writeback-notice\n) * {\n  box-sizing: border-box;\n}\n\n:is(\n  .dsh-knowledge-trigger,\n  .dsh-knowledge-activity-panel,\n  .dsh-knowledge-workspace,\n  .dsh-knowledge-settings-card,\n  .dsh-knowledge-writeback-notice\n) :where(button, input, textarea, select) {\n  margin: 0;\n  color: inherit;\n  font-family: var(--knowledge-font-family);\n  font-size: inherit;\n  font-weight: inherit;\n  line-height: inherit;\n  letter-spacing: inherit;\n}\n\n.dsh-knowledge-trigger,\n.dsh-knowledge-activity-panel button,\n.dsh-knowledge-activity-panel input,\n.dsh-knowledge-panel-state button,\n.dsh-knowledge-settings-card button,\n.dsh-knowledge-writeback-notice button {\n  -webkit-appearance: none;\n  appearance: none;\n  margin: 0;\n}\n\n/* The slot may add a display:contents boundary between its children and the\n   actual flex row. Cover both host structures: wrapping the boundary alone\n   does nothing and a full-width launcher pushes other plugins offscreen. */\n:has(> .dsh-knowledge-launcher),\n:has(> div > .dsh-knowledge-launcher) { flex-wrap: wrap; }\n/* In rail mode the host centers a 36px settings row. Use that same row\n   geometry, rather than forcing a percentage-width footer. */\n:has(> .dsh-knowledge-launcher--rail),\n:has(> div > .dsh-knowledge-launcher--rail) { flex-direction: column; align-items: center; }\n\n.dsh-knowledge-launcher {\n  display: flex;\n  flex: 0 0 calc(100% + 4px);\n  order: -1;\n  min-width: 0;\n  gap: 4px;\n  width: calc(100% + 4px);\n  margin: 4px -2px;\n  box-sizing: border-box;\n}\n\n.dsh-knowledge-launcher--rail { flex: none; width: 36px; margin: 8px 0 10px; flex-direction: column; align-items: center; }\n\n.dsh-knowledge-trigger {\n  position: relative;\n  flex: 1 1 auto;\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: auto;\n  height: 36px;\n  margin: 0;\n  padding: 0 10px 0 8px;\n  box-sizing: border-box;\n  border: 0;\n  border-radius: 12px;\n  overflow: hidden;\n  background: transparent;\n  color: var(--knowledge-text);\n  cursor: pointer;\n  font: inherit;\n  font-size: 14px;\n  line-height: 22px;\n  white-space: nowrap;\n  isolation: isolate;\n  transition:\n    color 120ms ease,\n    background-color 120ms ease,\n    box-shadow 160ms ease;\n}\n\n.dsh-knowledge-trigger:hover {\n  background: var(--knowledge-hover);\n}\n\n.dsh-knowledge-trigger:focus-visible,\n.dsh-knowledge-writeback-notice button:focus-visible {\n  outline: 2px solid var(--knowledge-accent);\n  outline-offset: 2px;\n}\n\n.dsh-knowledge-trigger.is-active {\n  background: var(--knowledge-control);\n  color: var(--knowledge-text);\n  box-shadow: 0 1px 2px rgb(0 0 0 / 7%), inset 0 1px 0 rgb(255 255 255 / 28%);\n}\n\n.dsh-knowledge-trigger--rail {\n  width: 36px;\n  height: 36px;\n  margin: 8px 0 10px;\n  padding: 0;\n  justify-content: center;\n  gap: 0;\n  border-radius: 50%;\n}\n\n.dsh-knowledge-trigger--rail { margin-inline: auto; }\n\n.dsh-knowledge-launcher .dsh-knowledge-trigger--rail { flex: none; margin-block: 0; }\n.dsh-knowledge-panel-trigger { flex: 0 0 36px; width: 36px; padding: 0; justify-content: center; }\n.dsh-knowledge-panel-trigger:disabled { opacity: .4; cursor: default; background: transparent; }\n.dsh-knowledge-launcher--rail .dsh-knowledge-panel-trigger { flex: none; border-radius: 50%; }\n\n@media (prefers-reduced-motion: reduce) {\n  .dsh-knowledge-trigger { transition: none; }\n}\n\n.dsh-knowledge-workspace {\n  width: 100%;\n  height: 100%;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n  background: var(--knowledge-canvas);\n}\n\n.dsh-knowledge-workspace-header {\n  position: relative;\n  z-index: 2;\n  flex: none;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  min-height: 52px;\n  margin: 8px 10px 0;\n  padding: 7px 14px;\n  box-sizing: border-box;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 14px 14px 11px 11px;\n  background: transparent;\n  box-shadow: var(--knowledge-glass-shadow);\n  -webkit-backdrop-filter: var(--knowledge-host-glass-filter);\n  backdrop-filter: var(--knowledge-host-glass-filter);\n}\n\n.dsh-knowledge-workspace-header > div {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n\n.dsh-knowledge-workspace-header [data-knowledge-workspace-close] {\n  -webkit-appearance: none;\n  appearance: none;\n  display: grid;\n  place-items: center;\n  box-sizing: border-box;\n  flex: none;\n  width: 30px;\n  height: 30px;\n  margin: 0;\n  padding: 0;\n  border: 1px solid transparent;\n  border-radius: 9px;\n  color: var(--knowledge-text-secondary);\n  background: transparent;\n  font: inherit;\n  line-height: 1;\n  -webkit-tap-highlight-color: transparent;\n  cursor: pointer;\n  transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;\n}\n\n.dsh-knowledge-workspace-header [data-knowledge-workspace-close]:hover {\n  border-color: var(--knowledge-border);\n  color: var(--knowledge-text);\n  background: var(--knowledge-control);\n}\n\n.dsh-knowledge-workspace-header [data-knowledge-workspace-close]:active { border-color: var(--knowledge-text-secondary); }\n.dsh-knowledge-workspace-header [data-knowledge-workspace-close]:focus-visible {\n  outline: 2px solid var(--knowledge-accent);\n  outline-offset: 2px;\n}\n.dsh-knowledge-workspace-header [data-knowledge-workspace-close] > svg {\n  display: block;\n  pointer-events: none;\n}\n\n.dsh-knowledge-workspace-header > div > span {\n  display: grid;\n  min-width: 0;\n  gap: 2px;\n}\n\n.dsh-knowledge-workspace-header h2,\n.dsh-knowledge-workspace-header p {\n  margin: 0;\n}\n\n.dsh-knowledge-workspace-header h2 {\n  color: var(--knowledge-text);\n  font-size: 15px;\n  line-height: 22px;\n  font-weight: 600;\n}\n\n.dsh-knowledge-workspace-header p {\n  color: var(--knowledge-text-secondary);\n  font-size: 11px;\n  line-height: 16px;\n}\n\n.dsh-knowledge-frame {\n  flex: 1;\n  display: block;\n  width: 100%;\n  min-height: 0;\n  margin: 0;\n  border: 0;\n  border-radius: 0;\n  background: transparent;\n  box-shadow: none;\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}\n\n.dsh-knowledge-panel-state {\n  flex: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 16px;\n  min-height: 0;\n  margin: 8px 10px 10px;\n  padding: 32px;\n  box-sizing: border-box;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 15px;\n  background: var(--knowledge-pane);\n  box-shadow: var(--knowledge-glass-shadow);\n  -webkit-backdrop-filter: var(--knowledge-host-glass-filter);\n  backdrop-filter: var(--knowledge-host-glass-filter);\n  color: var(--knowledge-text);\n}\n\n.dsh-knowledge-panel-state-icon {\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 40px;\n  height: 40px;\n  border-radius: 12px;\n  background: var(--knowledge-hover);\n  color: var(--knowledge-text-secondary);\n  font-size: 18px;\n  font-weight: 600;\n}\n\n.dsh-knowledge-panel-state > div { max-width: 560px; }\n.dsh-knowledge-panel-state h3 { margin: 0 0 6px; font-size: 17px; line-height: 24px; font-weight: 600; }\n.dsh-knowledge-panel-state p { margin: 0; color: var(--knowledge-text-secondary); font-size: 13px; line-height: 20px; }\n.dsh-knowledge-panel-state button {\n  min-width: 72px;\n  min-height: 32px;\n  margin-top: 16px;\n  padding: 6px 14px;\n  border: 0;\n  border-radius: 10px;\n  background: var(--knowledge-accent);\n  color: var(--knowledge-on-accent);\n  cursor: pointer;\n  font: inherit;\n}\n.dsh-knowledge-panel-state button:focus-visible {\n  outline: 2px solid var(--knowledge-accent);\n  outline-offset: 2px;\n}\n\n.dsh-knowledge-settings-card {\n  list-style: none;\n  overflow: hidden;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 14px;\n  background:\n    linear-gradient(145deg, color-mix(in srgb, var(--knowledge-glare-light) 16%, transparent), transparent 58%),\n    var(--knowledge-pane);\n  color: var(--knowledge-text);\n  box-shadow: var(--knowledge-glass-shadow), 0 8px 24px rgb(0 0 0 / 5%);\n  -webkit-backdrop-filter: var(--knowledge-glass-filter);\n  backdrop-filter: var(--knowledge-glass-filter);\n  transition: border-color 120ms ease, background-color 120ms ease;\n}\n.dsh-knowledge-settings-card:hover {\n  border-color: color-mix(in srgb, var(--knowledge-border) 68%, var(--knowledge-text-secondary));\n}\n.dsh-knowledge-settings-card--open {\n  border-color: color-mix(in srgb, var(--knowledge-border) 68%, var(--knowledge-text-secondary));\n  background: var(--knowledge-pane);\n}\n.dsh-knowledge-settings-header { display: flex; width: 100%; align-items: center; gap: 12px; padding: 14px 16px; border: 0; border-radius: 12px; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }\n.dsh-knowledge-settings-header:focus-visible {\n  outline: 2px solid var(--knowledge-accent);\n  outline-offset: -2px;\n}\n.dsh-knowledge-settings-actions button:focus-visible,\n.dsh-knowledge-settings-load-error button:focus-visible {\n  outline: 2px solid var(--knowledge-accent);\n  outline-offset: 2px;\n}\n.dsh-knowledge-settings-header > span:first-child { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 4px; }\n.dsh-knowledge-settings-header strong { font-size: 15px; font-weight: 600; line-height: 1.4; }\n.dsh-knowledge-settings-header small { color: var(--knowledge-text-tertiary); font-size: 13px; line-height: 1.5; }\n.dsh-knowledge-source-picker small,\n.dsh-knowledge-remote-fields small { color: var(--knowledge-text-secondary); font-size: 12px; }\n.dsh-knowledge-settings-summary { display: flex; flex: none; align-items: center; gap: 10px; color: var(--knowledge-text-tertiary); font-size: 12px; }\n.dsh-knowledge-settings-summary i { width: 8px; height: 8px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); transition: transform 160ms ease; }\n.dsh-knowledge-settings-card--open .dsh-knowledge-settings-summary i { transform: rotate(225deg); }\n\n.dsh-knowledge-settings-body {\n  display: grid;\n  gap: 18px;\n  margin: 0 16px;\n  padding-bottom: 8px;\n  border-top: 1px solid var(--knowledge-border);\n}\n\n.dsh-knowledge-source-picker {\n  min-width: 0;\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 10px;\n  margin: 18px 0 0;\n  padding: 0;\n  border: 0;\n}\n\n.dsh-knowledge-source-picker legend { margin-bottom: 8px; padding: 0; color: inherit; font-size: 13px; font-weight: 600; }\n.dsh-knowledge-source-picker label {\n  display: flex;\n  gap: 10px;\n  padding: 13px;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 14px;\n  cursor: pointer;\n}\n.dsh-knowledge-source-picker label.is-selected {\n  border-color: var(--knowledge-accent);\n  background: color-mix(in srgb, var(--knowledge-accent) 7%, transparent);\n}\n.dsh-knowledge-source-picker label.is-disabled {\n  cursor: default;\n  opacity: .55;\n}\n.dsh-knowledge-source-picker label:focus-within {\n  outline: 2px solid var(--knowledge-accent);\n  outline-offset: 2px;\n}\n.dsh-knowledge-source-picker input {\n  -webkit-appearance: none;\n  appearance: none;\n  width: 16px;\n  height: 16px;\n  display: inline-grid;\n  place-content: center;\n  flex: none;\n  margin: 2px 0 0;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 50%;\n  background: var(--knowledge-control);\n  color: var(--knowledge-on-accent);\n  cursor: pointer;\n  transition: border-color .15s ease, background-color .15s ease;\n}\n.dsh-knowledge-source-picker input::before {\n  content: "";\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: currentColor;\n  opacity: 0;\n  transform: scale(.55);\n  transition: opacity .12s ease, transform .15s cubic-bezier(.2, .8, .2, 1);\n}\n.dsh-knowledge-source-picker input:checked { border-color: var(--knowledge-accent); background: var(--knowledge-accent); }\n.dsh-knowledge-source-picker input:checked::before { opacity: 1; transform: scale(1); }\n.dsh-knowledge-source-picker input:disabled { cursor: default; }\n.dsh-knowledge-source-picker span { display: grid; gap: 3px; }\n\n.dsh-knowledge-remote-fields { display: grid; grid-template-columns: 1.25fr 1fr; gap: 12px; }\n.dsh-knowledge-remote-fields label,\n.dsh-knowledge-timeout-field { display: grid; gap: 6px; color: var(--knowledge-text-secondary); font-size: 12px; }\n.dsh-knowledge-remote-fields input,\n.dsh-knowledge-timeout-field input {\n  -webkit-appearance: none;\n  appearance: none;\n  min-height: 38px;\n  box-sizing: border-box;\n  padding: 8px 11px;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 10px;\n  outline: none;\n  background: var(--knowledge-control);\n  color: var(--knowledge-text);\n  font: inherit;\n}\n.dsh-knowledge-remote-fields input:focus,\n.dsh-knowledge-timeout-field input:focus { border-color: var(--knowledge-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--knowledge-accent) 16%, transparent); }\n.dsh-knowledge-remote-fields input:-webkit-autofill,\n.dsh-knowledge-remote-fields input:-webkit-autofill:hover,\n.dsh-knowledge-remote-fields input:-webkit-autofill:focus {\n  -webkit-text-fill-color: var(--knowledge-text);\n  box-shadow: 0 0 0 1000px var(--knowledge-control) inset;\n  caret-color: var(--knowledge-text);\n}\n.dsh-knowledge-timeout-field input::-webkit-inner-spin-button,\n.dsh-knowledge-timeout-field input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }\n.dsh-knowledge-timeout-field { max-width: 240px; }\n.dsh-knowledge-field-error { color: var(--knowledge-danger) !important; }\n\n.dsh-knowledge-settings-message,\n.dsh-knowledge-settings-note { margin: 0; color: var(--knowledge-text-secondary); font-size: 12px; }\n.dsh-knowledge-settings-message.is-success { color: var(--knowledge-success); }\n.dsh-knowledge-settings-message.is-error { color: var(--knowledge-danger); }\n.dsh-knowledge-settings-load-error {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  margin-top: 18px;\n  padding: 12px 14px;\n  border-radius: 12px;\n  background: color-mix(in srgb, var(--knowledge-danger) 8%, transparent);\n  color: var(--knowledge-danger);\n  font-size: 13px;\n}\n.dsh-knowledge-settings-load-error p { margin: 0; }\n.dsh-knowledge-settings-load-error button {\n  flex: none;\n  min-height: 30px;\n  padding: 5px 10px;\n  border: 0;\n  border-radius: 9px;\n  background: var(--knowledge-control);\n  color: var(--knowledge-text);\n  cursor: pointer;\n  font: inherit;\n}\n.dsh-knowledge-settings-actions { display: flex; justify-content: flex-end; gap: 8px; }\n.dsh-knowledge-settings-actions button {\n  min-height: 34px;\n  padding: 7px 13px;\n  border: 0;\n  border-radius: 10px;\n  background: var(--knowledge-hover);\n  color: var(--knowledge-text);\n  cursor: pointer;\n  font: inherit;\n  font-size: 13px;\n}\n.dsh-knowledge-settings-actions button.is-primary { background: var(--knowledge-accent); color: var(--knowledge-on-accent); }\n.dsh-knowledge-settings-actions button:disabled { cursor: default; opacity: .45; }\n\n@media (max-width: 720px) {\n  .dsh-knowledge-source-picker,\n  .dsh-knowledge-remote-fields { grid-template-columns: 1fr; }\n  .dsh-knowledge-settings-summary { font-size: 0; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dsh-knowledge-settings-card,\n  .dsh-knowledge-settings-header,\n  .dsh-knowledge-settings-summary i { transition: none; }\n}\n\n.dsh-knowledge-writeback-notice {\n  display: grid;\n  gap: 5px;\n  min-width: 0;\n  color: var(--knowledge-text-tertiary);\n  font-size: 12px;\n  line-height: 1.5;\n}\n.dsh-knowledge-writeback-summary {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n  min-width: 0;\n}\n.dsh-knowledge-writeback-notice strong {\n  color: var(--knowledge-text-secondary);\n  font-weight: 600;\n}\n.dsh-knowledge-writeback-notice button {\n  min-height: 24px;\n  padding: 0 9px;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 7px;\n  color: var(--knowledge-text-secondary);\n  background: var(--knowledge-control);\n  cursor: pointer;\n  font: inherit;\n}\n.dsh-knowledge-writeback-notice button:disabled { cursor: default; opacity: .5; }\n.dsh-knowledge-writeback-destinations {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 2px 12px;\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  list-style: none;\n}\n.dsh-knowledge-writeback-destinations li {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  min-width: 0;\n  max-width: 100%;\n  padding: 0;\n  border: 0;\n  background: transparent;\n}\n.dsh-knowledge-writeback-base,\n.dsh-knowledge-writeback-separator {\n  flex: none;\n}\n.dsh-knowledge-writeback-separator {\n  color: var(--knowledge-text-tertiary);\n}\n.dsh-knowledge-writeback-destinations strong {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.dsh-knowledge-writeback-notice .dsh-knowledge-writeback-document {\n  display: inline-flex;\n  align-items: center;\n  min-width: 0;\n  min-height: 24px;\n  padding: 0 3px;\n  border: 0;\n  border-radius: 4px;\n  background: transparent;\n  color: var(--knowledge-text-secondary);\n  text-decoration: underline;\n  text-decoration-color: transparent;\n  text-underline-offset: 3px;\n  transition: color 120ms ease, background-color 120ms ease, text-decoration-color 120ms ease;\n}\n.dsh-knowledge-writeback-notice .dsh-knowledge-writeback-document:hover {\n  background: var(--knowledge-hover);\n  color: var(--knowledge-text);\n  text-decoration-color: currentColor;\n}\n.dsh-knowledge-writeback-document strong { color: inherit; }\n.dsh-knowledge-writeback-destinations small {\n  flex: none;\n  color: var(--knowledge-text-secondary);\n  font: inherit;\n  white-space: nowrap;\n}\n.dsh-knowledge-writeback-destinations small[data-disposition="written"] { color: var(--knowledge-success); }\n.dsh-knowledge-writeback-error {\n  max-width: min(720px, 100%);\n  margin: 0;\n  color: var(--knowledge-danger);\n  overflow-wrap: anywhere;\n}\n.dsh-knowledge-panel-right-icon {\n  transform: rotate(180deg);\n}\n';

// src/main-panel-compat.ts
var import_react2 = require("react");
function registerMainPanel(ctx, id, priority, render, onHidden = () => {
}) {
  const layout = ctx.layout;
  if (typeof layout.selectPanel !== "function") {
    return ctx.slots.register({ name: "conversation", priority }, render);
  }
  const slots = ctx.slots;
  let disposed = false;
  let generation = 0;
  const Body = (props) => {
    (0, import_react2.useEffect)(() => {
      const current = ++generation;
      return () => {
        queueMicrotask(() => {
          if (!disposed && generation === current) onHidden();
        });
      };
    }, []);
    return render(props);
  };
  const remove = slots.register({ name: "main", key: id }, Body);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    remove();
  };
  try {
    layout.selectPanel(id);
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}

// src/knowledge-activity.css
var knowledge_activity_default = '.dsh-knowledge-activity-viewport {\n  width: 100%;\n  height: 100%;\n  min-width: 0;\n  overflow: hidden;\n  contain: layout paint;\n}\n\n.dsh-knowledge-activity-panel {\n  display: flex;\n  width: 100%;\n  height: 100%;\n  min-width: 0;\n  min-height: 0;\n  flex-direction: column;\n  overflow: hidden;\n  color: var(--knowledge-text);\n  background: var(--activity-surface);\n  -webkit-backdrop-filter: var(--knowledge-embedded-filter);\n  backdrop-filter: var(--knowledge-embedded-filter);\n  box-shadow: inset 1px 0 0 var(--knowledge-border);\n  font-family: var(--knowledge-font-family);\n  font-size: 13px;\n  line-height: 1.5;\n}\n\n.dsh-knowledge-activity-panel *,\n.dsh-knowledge-activity-panel *::before,\n.dsh-knowledge-activity-panel *::after { box-sizing: border-box; }\n\n.dsh-knowledge-activity-panel ::selection { background: var(--selection-background); color: var(--selection-text); }\n\n.dsh-knowledge-activity-panel :where(button, input) {\n  -webkit-appearance: none;\n  appearance: none;\n  margin: 0;\n  color: inherit;\n  font: inherit;\n  letter-spacing: inherit;\n}\n\n.dsh-knowledge-activity-header {\n  display: flex;\n  min-height: 58px;\n  padding: 0 12px 0 15px;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  border-bottom: 1px solid var(--knowledge-border);\n  background: transparent;\n}\n\n.dsh-knowledge-activity-tabs {\n  display: grid;\n  min-height: 43px;\n  flex: none;\n  grid-template-columns: 1fr 1fr;\n  gap: 4px;\n  padding: 5px 10px;\n  border-bottom: 1px solid var(--knowledge-border);\n  background: transparent;\n}\n.dsh-knowledge-activity-tabs button {\n  display: inline-flex;\n  min-width: 0;\n  min-height: 32px;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  padding: 0 10px;\n  border: 1px solid transparent;\n  border-radius: 9px;\n  color: var(--knowledge-text-tertiary);\n  background: transparent;\n  cursor: pointer;\n  font-size: 12px;\n  font-weight: 580;\n}\n.dsh-knowledge-activity-tabs button:hover { color: var(--knowledge-text); background: var(--knowledge-hover); }\n.dsh-knowledge-activity-tabs button.is-active {\n  border-color: var(--knowledge-border);\n  color: var(--knowledge-text);\n  background: var(--knowledge-embedded-control);\n  box-shadow: inset 0 1px 0 var(--knowledge-glare-light);\n}\n\n.dsh-knowledge-activity-title,\n.dsh-knowledge-activity-header-actions { display: flex; min-width: 0; align-items: center; gap: 9px; }\n.dsh-knowledge-activity-title > span:last-child { display: grid; min-width: 0; gap: 1px; }\n.dsh-knowledge-activity-title strong { overflow: hidden; font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-knowledge-activity-title small { overflow: hidden; color: var(--knowledge-text-tertiary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }\n\n.dsh-knowledge-activity-mark,\n.dsh-knowledge-activity-document-icon,\n.dsh-knowledge-activity-row-icon {\n  display: grid;\n  flex: none;\n  place-items: center;\n  border: 1px solid color-mix(in srgb, var(--knowledge-accent) 18%, transparent);\n  color: var(--knowledge-accent);\n  background: color-mix(in srgb, var(--knowledge-accent) 6%, transparent);\n}\n\n.dsh-knowledge-activity-mark { width: 27px; height: 27px; border: 0; border-radius: 8px; background: transparent; }\n.dsh-knowledge-activity-icon-button {\n  display: grid;\n  width: 32px;\n  height: 32px;\n  flex: none;\n  place-items: center;\n  padding: 0;\n  border: 1px solid transparent;\n  border-radius: 9px;\n  color: var(--knowledge-text-secondary);\n  background: transparent;\n  cursor: pointer;\n}\n.dsh-knowledge-activity-icon-button:hover { border-color: var(--knowledge-border); color: var(--knowledge-text); background: var(--knowledge-hover); }\n.dsh-knowledge-activity-icon-button:focus-visible,\n.dsh-knowledge-activity-panel button:focus-visible,\n.dsh-knowledge-activity-panel input:focus-visible { outline: 2px solid var(--knowledge-accent); outline-offset: 2px; }\n\n.dsh-knowledge-activity-browser,\n.dsh-knowledge-activity-reader {\n  display: flex;\n  min-height: 0;\n  flex: 1;\n  flex-direction: column;\n  overflow: hidden;\n  padding: 14px 14px 16px;\n}\n\n.dsh-knowledge-activity-search {\n  display: flex;\n  min-height: 40px;\n  flex: none;\n  align-items: center;\n  gap: 8px;\n  padding: 0 10px;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 10px;\n  color: var(--knowledge-text-tertiary);\n  background: var(--knowledge-embedded-control);\n}\n.dsh-knowledge-activity-search:focus-within { border-color: var(--knowledge-border); box-shadow: none; background: color-mix(in srgb, var(--knowledge-text) 5%, var(--knowledge-embedded-control)); }\n.dsh-knowledge-activity-search input { min-width: 0; height: 38px; flex: 1; padding: 0; border: 0; outline: 0 !important; color: var(--knowledge-text); background: transparent; box-shadow: none; }\n.dsh-knowledge-activity-search input::placeholder { color: var(--knowledge-text-tertiary); opacity: 1; }\n/* Host themes can force a focus outline with #root and !important. */\n#root .dsh-knowledge-activity-search input:is(:focus, :focus-visible) {\n  outline: none !important;\n  outline-offset: 0 !important;\n  border: 0;\n  box-shadow: none !important;\n}\n.dsh-knowledge-activity-search > button { display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 0; border-radius: 8px; color: var(--knowledge-text-tertiary); background: transparent; cursor: pointer; }\n.dsh-knowledge-activity-search > button:hover { color: var(--knowledge-text); background: var(--knowledge-hover); }\n\n.dsh-knowledge-activity-scope { position: relative; z-index: 3; flex: none; margin-top: 10px; }\n.dsh-knowledge-activity-breadcrumbs {\n  display: flex;\n  min-height: 37px;\n  flex: none;\n  align-items: center;\n  gap: 1px;\n  overflow-x: auto;\n  padding: 5px 1px 2px;\n  color: var(--knowledge-text-tertiary);\n  scrollbar-width: none;\n}\n.dsh-knowledge-activity-breadcrumbs::-webkit-scrollbar { display: none; }\n.dsh-knowledge-activity-breadcrumbs span { display: inline-flex; flex: none; align-items: center; gap: 1px; }\n.dsh-knowledge-activity-breadcrumbs button {\n  max-width: 130px;\n  min-height: 28px;\n  overflow: hidden;\n  padding: 0 7px;\n  border: 0;\n  border-radius: 7px;\n  color: inherit;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  background: transparent;\n  cursor: pointer;\n  font-size: 11px;\n}\n.dsh-knowledge-activity-breadcrumbs button:hover { color: var(--knowledge-text); background: var(--knowledge-hover); }\n.dsh-knowledge-activity-breadcrumbs button[aria-current="location"] { color: var(--knowledge-text-secondary); font-weight: 620; }\n.dsh-knowledge-activity-scope-trigger {\n  display: grid;\n  width: 100%;\n  min-height: 48px;\n  grid-template-columns: 30px minmax(0, 1fr) 20px;\n  align-items: center;\n  gap: 8px;\n  padding: 5px 9px;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 10px;\n  text-align: left;\n  background: color-mix(in srgb, var(--knowledge-embedded-control) 72%, transparent);\n  cursor: pointer;\n}\n.dsh-knowledge-activity-scope-trigger:hover { background: var(--knowledge-embedded-control); }\n.dsh-knowledge-activity-scope-trigger > span:nth-child(2) { display: grid; min-width: 0; gap: 1px; }\n.dsh-knowledge-activity-scope-trigger small { color: var(--knowledge-text-tertiary); font-size: 10px; }\n.dsh-knowledge-activity-scope-trigger strong { overflow: hidden; font-size: 12px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-knowledge-activity-scope-trigger > svg { color: var(--knowledge-text-tertiary); transition: transform 140ms ease; }\n.dsh-knowledge-activity-scope-trigger > svg.is-open { transform: rotate(180deg); }\n.dsh-knowledge-activity-scope-icon { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 8px; color: var(--knowledge-accent); background: color-mix(in srgb, var(--knowledge-accent) 8%, transparent); }\n.dsh-knowledge-activity-scope-menu {\n  position: absolute;\n  z-index: 6;\n  top: calc(100% + 6px);\n  right: 0;\n  left: 0;\n  max-height: min(320px, 44vh);\n  overflow-y: auto;\n  padding: 5px;\n  border: 1px solid var(--knowledge-border);\n  border-radius: 12px;\n  background: var(--dialog-surface);\n  box-shadow: 0 16px 38px rgb(24 30 32 / 18%), inset 0 1px 0 var(--knowledge-glare-light);\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}\n.dsh-knowledge-activity-scope-menu button { display: flex; width: 100%; min-height: 46px; align-items: center; gap: 9px; padding: 6px 9px; border: 0; border-radius: 8px; text-align: left; background: transparent; cursor: pointer; }\n.dsh-knowledge-activity-scope-menu button:hover { background: var(--knowledge-hover); }\n.dsh-knowledge-activity-scope-menu button.is-active { background: var(--knowledge-embedded-control); }\n.dsh-knowledge-activity-scope-menu button > svg { flex: none; color: var(--knowledge-text-secondary); }\n.dsh-knowledge-activity-scope-menu button > span { display: grid; min-width: 0; gap: 1px; }\n.dsh-knowledge-activity-scope-menu button strong { overflow: hidden; font-size: 12px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-knowledge-activity-scope-menu button small { color: var(--knowledge-text-tertiary); font-size: 10px; }\n\n.dsh-knowledge-activity-list-heading {\n  display: flex;\n  min-height: 46px;\n  flex: none;\n  align-items: center;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 8px 2px 6px;\n  border-bottom: 1px solid var(--knowledge-border);\n}\n.dsh-knowledge-activity-list-heading > span { display: grid; min-width: 0; }\n.dsh-knowledge-activity-list-heading strong { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-knowledge-activity-list-heading small { color: var(--knowledge-text-tertiary); font-size: 11px; }\n\n.dsh-knowledge-activity-list {\n  min-height: 0;\n  flex: 1;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 0 0 20px;\n  scrollbar-color: color-mix(in srgb, var(--knowledge-text-tertiary) 35%, transparent) transparent;\n  scrollbar-width: thin;\n}\n.dsh-knowledge-activity-row {\n  display: flex;\n  width: 100%;\n  min-height: 61px;\n  align-items: center;\n  gap: 9px;\n  padding: 8px 6px;\n  border: 0;\n  border-bottom: 1px solid color-mix(in srgb, var(--knowledge-border) 72%, transparent);\n  border-radius: 0;\n  text-align: left;\n  background: transparent;\n  cursor: pointer;\n}\n.dsh-knowledge-activity-row:hover { border-radius: 8px; background: var(--knowledge-hover); }\n.dsh-knowledge-activity-row:disabled { cursor: default; opacity: .58; }\n.dsh-knowledge-activity-row:disabled:hover { border-radius: 0; background: transparent; }\n.dsh-knowledge-activity-row-icon { width: 27px; height: 27px; border: 0; border-radius: 0; background: transparent; }\n.dsh-knowledge-activity-row-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }\n.dsh-knowledge-activity-row-copy strong,\n.dsh-knowledge-activity-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-knowledge-activity-row-copy strong { color: var(--knowledge-text); font-size: 13px; font-weight: 600; }\n.dsh-knowledge-activity-row-copy small { color: var(--knowledge-text-tertiary); font-size: 10px; }\n.dsh-knowledge-activity-row-meta { display: grid; flex: none; justify-items: end; align-items: center; gap: 3px; color: var(--knowledge-text-tertiary); font-size: 10px; }\n.dsh-knowledge-activity-row-meta em { padding: 1px 5px; border-radius: 999px; color: var(--knowledge-text-secondary); background: var(--knowledge-embedded-control); font-style: normal; }\n.dsh-knowledge-activity-load-more { display: block; min-height: 36px; margin: 8px auto 0; padding: 0 14px; border: 1px solid var(--knowledge-border); border-radius: 10px; color: var(--knowledge-text-secondary); background: var(--knowledge-embedded-control); cursor: pointer; }\n.dsh-knowledge-activity-load-more:hover:not(:disabled) { color: var(--knowledge-text); background: var(--knowledge-hover); }\n\n.dsh-knowledge-activity-reader-bar {\n  display: flex;\n  min-height: 38px;\n  flex: none;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  border-bottom: 1px solid var(--knowledge-border);\n  color: var(--knowledge-text-tertiary);\n  font-size: 11px;\n}\n.dsh-knowledge-activity-back { display: inline-flex; min-height: 32px; align-items: center; gap: 4px; padding: 0 7px 0 4px; border: 0; border-radius: 8px; color: var(--knowledge-text-secondary); background: transparent; cursor: pointer; font-size: 12px !important; }\n.dsh-knowledge-activity-back:hover { color: var(--knowledge-text); background: var(--knowledge-hover); }\n.dsh-knowledge-activity-document-heading { display: flex; flex: none; align-items: center; gap: 10px; padding: 16px 4px 13px; }\n.dsh-knowledge-activity-document-icon { width: 36px; height: 36px; border-radius: 11px; }\n.dsh-knowledge-activity-document-heading > div { min-width: 0; }\n.dsh-knowledge-activity-document-heading h2 { overflow: hidden; margin: 0; font-size: 16px; line-height: 22px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }\n.dsh-knowledge-activity-document-heading p { overflow: hidden; margin: 1px 0 0; color: var(--knowledge-text-tertiary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }\n\n.dsh-knowledge-activity-markdown {\n  min-height: 0;\n  flex: 1;\n  overflow-y: auto;\n  padding: 0 5px 44px;\n  color: var(--knowledge-text);\n  font-size: 13px;\n  line-height: 1.75;\n  overflow-wrap: anywhere;\n  scrollbar-color: color-mix(in srgb, var(--knowledge-text-tertiary) 35%, transparent) transparent;\n  scrollbar-width: thin;\n}\n.dsh-knowledge-activity-markdown :where(h1, h2, h3, h4, h5, h6) { margin: 1.35em 0 .55em; color: var(--knowledge-text); line-height: 1.35; font-weight: 650; }\n.dsh-knowledge-activity-markdown h1 { font-size: 18px; }\n.dsh-knowledge-activity-markdown h2 { padding-bottom: .35em; border-bottom: 1px solid var(--knowledge-border); font-size: 16px; }\n.dsh-knowledge-activity-markdown h3 { font-size: 14px; }\n.dsh-knowledge-activity-markdown :where(h4, h5, h6) { font-size: 13px; }\n.dsh-knowledge-activity-markdown hr { height: 1px; margin: 18px 0; border: 0; background: var(--knowledge-border); }\n.dsh-knowledge-activity-markdown summary { cursor: pointer; color: var(--knowledge-text); }\n.dsh-knowledge-activity-markdown :where(p, ul, ol, blockquote, pre, table) { margin: .7em 0; }\n.dsh-knowledge-activity-markdown :where(ul, ol) { padding-left: 1.5em; }\n.dsh-knowledge-activity-markdown a { color: var(--knowledge-accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }\n.dsh-knowledge-activity-markdown blockquote { margin-left: 0; padding: .15em 0 .15em 12px; border-left: 3px solid color-mix(in srgb, var(--knowledge-accent) 40%, transparent); color: var(--knowledge-text-secondary); }\n.dsh-knowledge-activity-markdown :where(code, pre) { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }\n.dsh-knowledge-activity-markdown code { padding: .14em .32em; border-radius: 5px; background: var(--knowledge-embedded-control); font-size: .92em; }\n.dsh-knowledge-activity-markdown pre { overflow-x: auto; padding: 11px 12px; border: 1px solid var(--knowledge-border); border-radius: 10px; background: var(--knowledge-embedded-control); }\n.dsh-knowledge-activity-markdown pre code { padding: 0; background: transparent; }\n.dsh-knowledge-activity-markdown table { width: 100%; border-collapse: collapse; font-size: 12px; }\n.dsh-knowledge-activity-markdown :where(th, td) { padding: 6px 7px; border: 1px solid var(--knowledge-border); text-align: left; }\n.dsh-knowledge-activity-markdown img { display: block; max-width: 100%; height: auto; border-radius: 10px; }\n\n.dsh-knowledge-activity-state,\n.dsh-knowledge-activity-error,\n.dsh-knowledge-activity-empty { margin: auto; text-align: center; }\n.dsh-knowledge-activity-state { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px 10px; color: var(--knowledge-text-tertiary); }\n.dsh-knowledge-activity-state > span { width: 8px; height: 8px; border: 2px solid var(--knowledge-border); border-top-color: var(--knowledge-accent); border-radius: 50%; animation: dsh-knowledge-activity-spin .8s linear infinite; }\n.dsh-knowledge-activity-error,\n.dsh-knowledge-activity-empty { display: grid; max-width: 260px; justify-items: center; gap: 6px; padding: 32px 12px; }\n.dsh-knowledge-activity-error strong,\n.dsh-knowledge-activity-empty strong { font-size: 13px; font-weight: 650; }\n.dsh-knowledge-activity-error p,\n.dsh-knowledge-activity-empty p { margin: 0; color: var(--knowledge-text-tertiary); font-size: 11px; line-height: 1.65; }\n.dsh-knowledge-activity-empty > span { display: grid; width: 40px; height: 40px; margin-bottom: 3px; place-items: center; border-radius: 13px; color: var(--knowledge-text-secondary); background: var(--knowledge-embedded-control); }\n.dsh-knowledge-activity-error > button { min-height: 34px; margin-top: 6px; padding: 0 13px; border: 1px solid var(--knowledge-border); border-radius: 9px; background: var(--knowledge-embedded-control); cursor: pointer; }\n.dsh-knowledge-activity-error > button:hover { background: var(--knowledge-hover); }\n\n@keyframes dsh-knowledge-activity-spin { to { transform: rotate(360deg); } }\n\n@media (max-width: 460px) {\n  .dsh-knowledge-activity-header { padding-inline: 10px; }\n  .dsh-knowledge-activity-browser,\n  .dsh-knowledge-activity-reader { padding: 10px 10px max(14px, env(safe-area-inset-bottom)); }\n  .dsh-knowledge-activity-search input { font-size: 16px; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dsh-knowledge-activity-panel,\n  .dsh-knowledge-activity-state > span,\n  .dsh-knowledge-activity-scope-trigger > svg { animation: none; transition: none; }\n}\n';

// src/knowledge-activity-panel.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/knowledge-activity-api.ts
var API_PREFIX = "/knowledge-control/v1/activity";
var CLIENT_HEADER = "conversation-web";
async function loadMountedKnowledge(sessionId, projectId, signal) {
  const params = new URLSearchParams({ sessionId });
  if (projectId !== void 0) params.set("projectId", projectId);
  const value = await request(`mounts?${params}`, signal);
  if (!Array.isArray(value)) throw new Error("\u77E5\u8BC6\u5E93\u6302\u8F7D\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  return value.filter(isResolvedMount);
}
async function loadKnowledgeDocumentIndex(input) {
  const params = new URLSearchParams({ sessionId: input.sessionId, limit: "60" });
  if (input.projectId !== void 0) params.set("projectId", input.projectId);
  for (const id of input.knowledgeBaseIds) params.append("knowledgeBaseId", id);
  if (input.query?.trim()) params.set("q", input.query.trim());
  if (input.cursor !== void 0) params.set("cursor", input.cursor);
  const value = await request(`documents?${params}`, input.signal);
  if (!isDocumentIndex(value)) throw new Error("\u77E5\u8BC6\u6587\u6863\u76EE\u5F55\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  return value;
}
async function loadNoteIndex(input) {
  const params = new URLSearchParams({ sessionId: input.sessionId, limit: "200" });
  if (input.projectId !== void 0) params.set("projectId", input.projectId);
  if (input.query?.trim()) params.set("q", input.query.trim());
  else if (input.parentId !== void 0 && input.parentId !== null) params.set("parentId", input.parentId);
  const value = await request(`notes?${params}`, input.signal);
  if (!Array.isArray(value) || !value.every(isNoteNode)) throw new Error("\u7B14\u8BB0\u76EE\u5F55\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  return value;
}
async function loadNoteContent(input) {
  const params = new URLSearchParams({ sessionId: input.sessionId });
  if (input.projectId !== void 0) params.set("projectId", input.projectId);
  const value = await request(`notes/${encodeURIComponent(input.id)}/content?${params}`, input.signal);
  if (!isRecord(value) || !isNoteNode(value.node) || typeof value.content !== "string") {
    throw new Error("\u7B14\u8BB0\u6B63\u6587\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  }
  return value;
}
async function loadKnowledgeDocument(input) {
  const params = new URLSearchParams({ sessionId: input.sessionId });
  if (input.projectId !== void 0) params.set("projectId", input.projectId);
  const value = await request(`documents/${encodeURIComponent(input.id)}?${params}`, input.signal);
  if (!isDocument(value)) throw new Error("\u77E5\u8BC6\u6587\u6863\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  return value;
}
async function request(path, signal) {
  const response = await fetch(`${API_PREFIX}/${path}`, {
    headers: { accept: "application/json", "x-dsh-knowledge-client": CLIENT_HEADER },
    ...signal === void 0 ? {} : { signal }
  });
  const body = await response.json().catch(() => void 0);
  if (!response.ok) {
    const message3 = isRecord(body) && typeof body.error === "string" ? body.error : `\u77E5\u8BC6\u5E93\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`;
    throw new Error(message3);
  }
  return body;
}
function isResolvedMount(value) {
  return isRecord(value) && typeof value.knowledgeBaseId === "string" && typeof value.enabled === "boolean" && isRecord(value.base) && typeof value.base.id === "string" && typeof value.base.name === "string";
}
function isDocumentIndex(value) {
  return isRecord(value) && Array.isArray(value.items) && value.items.every(isDocumentSummary) && Number.isInteger(value.total) && (value.nextCursor === void 0 || typeof value.nextCursor === "string");
}
function isDocumentSummary(value) {
  return isRecord(value) && typeof value.id === "string" && typeof value.knowledgeBaseId === "string" && typeof value.relPath === "string" && typeof value.title === "string" && typeof value.updatedAt === "string" && (value.documentState === "open" || value.documentState === "resolved" || value.documentState === "complete");
}
function isDocument(value) {
  return isDocumentSummary(value) && isRecord(value) && typeof value.content === "string";
}
function isNoteNode(value) {
  return isRecord(value) && typeof value.id === "string" && (value.parentId === null || typeof value.parentId === "string") && (value.kind === "folder" || value.kind === "document" || value.kind === "file") && typeof value.name === "string" && (value.mediaType === null || typeof value.mediaType === "string") && typeof value.editable === "boolean" && typeof value.size === "number" && typeof value.version === "number" && typeof value.updatedAt === "string";
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// src/knowledge-activity-notes.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/latest-request.ts
var LatestRequest = class {
  current;
  start() {
    this.cancel();
    this.current = new AbortController();
    return this.current.signal;
  }
  cancel() {
    this.current?.abort();
    this.current = void 0;
  }
};

// node_modules/dompurify/dist/purify.es.mjs
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
function _iterableToArrayLimit(r, l3) {
  var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
  if (null != t) {
    var e, n, i, u, a = [], f2 = true, o = false;
    try {
      if (i = (t = t.call(r)).next, 0 === l3) ;
      else for (; !(f2 = (e = i.call(t)).done) && (a.push(e.value), a.length !== l3); f2 = true) ;
    } catch (r2) {
      o = true, n = r2;
    } finally {
      try {
        if (!f2 && null != t.return && (u = t.return(), Object(u) !== u)) return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _nonIterableRest() {
  throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}
function _slicedToArray(r, e) {
  return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ("string" == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
  }
}
var entries = Object.entries;
var setPrototypeOf = Object.setPrototypeOf;
var isFrozen = Object.isFrozen;
var getPrototypeOf = Object.getPrototypeOf;
var getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
var freeze = Object.freeze;
var seal = Object.seal;
var create = Object.create;
var _ref = typeof Reflect !== "undefined" && Reflect;
var apply = _ref.apply;
var construct = _ref.construct;
if (!freeze) {
  freeze = function freeze2(x2) {
    return x2;
  };
}
if (!seal) {
  seal = function seal2(x2) {
    return x2;
  };
}
if (!apply) {
  apply = function apply3(func, thisArg) {
    for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
      args[_key - 2] = arguments[_key];
    }
    return func.apply(thisArg, args);
  };
}
if (!construct) {
  construct = function construct2(Func) {
    for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
      args[_key2 - 1] = arguments[_key2];
    }
    return new Func(...args);
  };
}
var arrayForEach = unapply(Array.prototype.forEach);
var arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
var arrayPop = unapply(Array.prototype.pop);
var arrayPush = unapply(Array.prototype.push);
var arraySplice = unapply(Array.prototype.splice);
var arrayIsArray = Array.isArray;
var stringToLowerCase = unapply(String.prototype.toLowerCase);
var stringToString = unapply(String.prototype.toString);
var stringMatch = unapply(String.prototype.match);
var stringReplace = unapply(String.prototype.replace);
var stringIndexOf = unapply(String.prototype.indexOf);
var stringTrim = unapply(String.prototype.trim);
var numberToString = unapply(Number.prototype.toString);
var booleanToString = unapply(Boolean.prototype.toString);
var bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
var symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
var objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
var objectToString = unapply(Object.prototype.toString);
var regExpTest = unapply(RegExp.prototype.test);
var typeErrorCreate = unconstruct(TypeError);
function unapply(func) {
  return function(thisArg) {
    if (thisArg instanceof RegExp) {
      thisArg.lastIndex = 0;
    }
    for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
      args[_key3 - 1] = arguments[_key3];
    }
    return apply(func, thisArg, args);
  };
}
function unconstruct(Func) {
  return function() {
    for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
      args[_key4] = arguments[_key4];
    }
    return construct(Func, args);
  };
}
function addToSet(set, array) {
  let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
  if (setPrototypeOf) {
    setPrototypeOf(set, null);
  }
  if (!arrayIsArray(array)) {
    return set;
  }
  let l3 = array.length;
  while (l3--) {
    let element = array[l3];
    if (typeof element === "string") {
      const lcElement = transformCaseFunc(element);
      if (lcElement !== element) {
        if (!isFrozen(array)) {
          array[l3] = lcElement;
        }
        element = lcElement;
      }
    }
    set[element] = true;
  }
  return set;
}
function cleanArray(array) {
  for (let index = 0; index < array.length; index++) {
    const isPropertyExist = objectHasOwnProperty(array, index);
    if (!isPropertyExist) {
      array[index] = null;
    }
  }
  return array;
}
function clone(object) {
  const newObject = create(null);
  for (const _ref2 of entries(object)) {
    var _ref3 = _slicedToArray(_ref2, 2);
    const property = _ref3[0];
    const value = _ref3[1];
    const isPropertyExist = objectHasOwnProperty(object, property);
    if (isPropertyExist) {
      if (arrayIsArray(value)) {
        newObject[property] = cleanArray(value);
      } else if (value && typeof value === "object" && value.constructor === Object) {
        newObject[property] = clone(value);
      } else {
        newObject[property] = value;
      }
    }
  }
  return newObject;
}
function stringifyValue(value) {
  switch (typeof value) {
    case "string": {
      return value;
    }
    case "number": {
      return numberToString(value);
    }
    case "boolean": {
      return booleanToString(value);
    }
    case "bigint": {
      return bigintToString ? bigintToString(value) : "0";
    }
    case "symbol": {
      return symbolToString ? symbolToString(value) : "Symbol()";
    }
    case "undefined": {
      return objectToString(value);
    }
    case "function":
    case "object": {
      if (value === null) {
        return objectToString(value);
      }
      const valueAsRecord = value;
      const valueToString = lookupGetter(valueAsRecord, "toString");
      if (typeof valueToString === "function") {
        const stringified = valueToString(valueAsRecord);
        return typeof stringified === "string" ? stringified : objectToString(stringified);
      }
      return objectToString(value);
    }
    default: {
      return objectToString(value);
    }
  }
}
function lookupGetter(object, prop) {
  while (object !== null) {
    const desc = getOwnPropertyDescriptor(object, prop);
    if (desc) {
      if (desc.get) {
        return unapply(desc.get);
      }
      if (typeof desc.value === "function") {
        return unapply(desc.value);
      }
    }
    object = getPrototypeOf(object);
  }
  function fallbackValue() {
    return null;
  }
  return fallbackValue;
}
function isRegex(value) {
  try {
    regExpTest(value, "");
    return true;
  } catch (_unused) {
    return false;
  }
}
var html$1 = freeze(["a", "abbr", "acronym", "address", "area", "article", "aside", "audio", "b", "bdi", "bdo", "big", "blink", "blockquote", "body", "br", "button", "canvas", "caption", "center", "cite", "code", "col", "colgroup", "content", "data", "datalist", "dd", "decorator", "del", "details", "dfn", "dialog", "dir", "div", "dl", "dt", "element", "em", "fieldset", "figcaption", "figure", "font", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "img", "input", "ins", "kbd", "label", "legend", "li", "main", "map", "mark", "marquee", "menu", "menuitem", "meter", "nav", "nobr", "ol", "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "search", "section", "select", "shadow", "slot", "small", "source", "spacer", "span", "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "tr", "track", "tt", "u", "ul", "var", "video", "wbr"]);
var svg$1 = freeze(["svg", "a", "altglyph", "altglyphdef", "altglyphitem", "animatecolor", "animatemotion", "animatetransform", "circle", "clippath", "defs", "desc", "ellipse", "enterkeyhint", "exportparts", "filter", "font", "g", "glyph", "glyphref", "hkern", "image", "inputmode", "line", "lineargradient", "marker", "mask", "metadata", "mpath", "part", "path", "pattern", "polygon", "polyline", "radialgradient", "rect", "stop", "style", "switch", "symbol", "text", "textpath", "title", "tref", "tspan", "view", "vkern"]);
var svgFilters = freeze(["feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence"]);
var svgDisallowed = freeze(["animate", "color-profile", "cursor", "discard", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "foreignobject", "hatch", "hatchpath", "mesh", "meshgradient", "meshpatch", "meshrow", "missing-glyph", "script", "set", "solidcolor", "unknown", "use"]);
var mathMl$1 = freeze(["math", "menclose", "merror", "mfenced", "mfrac", "mglyph", "mi", "mlabeledtr", "mmultiscripts", "mn", "mo", "mover", "mpadded", "mphantom", "mroot", "mrow", "ms", "mspace", "msqrt", "mstyle", "msub", "msup", "msubsup", "mtable", "mtd", "mtext", "mtr", "munder", "munderover", "mprescripts"]);
var mathMlDisallowed = freeze(["maction", "maligngroup", "malignmark", "mlongdiv", "mscarries", "mscarry", "msgroup", "mstack", "msline", "msrow", "semantics", "annotation", "annotation-xml", "mprescripts", "none"]);
var text = freeze(["#text"]);
var html = freeze(["accept", "action", "align", "alt", "autocapitalize", "autocomplete", "autopictureinpicture", "autoplay", "background", "bgcolor", "border", "capture", "cellpadding", "cellspacing", "checked", "cite", "class", "clear", "color", "cols", "colspan", "command", "commandfor", "controls", "controlslist", "coords", "crossorigin", "datetime", "decoding", "default", "dir", "disabled", "disablepictureinpicture", "disableremoteplayback", "download", "draggable", "enctype", "enterkeyhint", "exportparts", "face", "for", "headers", "height", "hidden", "high", "href", "hreflang", "id", "inert", "inputmode", "integrity", "ismap", "kind", "label", "lang", "list", "loading", "loop", "low", "max", "maxlength", "media", "method", "min", "minlength", "multiple", "muted", "name", "nonce", "noshade", "novalidate", "nowrap", "open", "optimum", "part", "pattern", "placeholder", "playsinline", "popover", "popovertarget", "popovertargetaction", "poster", "preload", "pubdate", "radiogroup", "readonly", "rel", "required", "rev", "reversed", "role", "rows", "rowspan", "spellcheck", "scope", "selected", "shape", "size", "sizes", "slot", "span", "srclang", "start", "src", "srcset", "step", "style", "summary", "tabindex", "title", "translate", "type", "usemap", "valign", "value", "width", "wrap", "xmlns"]);
var svg = freeze(["accent-height", "accumulate", "additive", "alignment-baseline", "amplitude", "ascent", "attributename", "attributetype", "azimuth", "basefrequency", "baseline-shift", "begin", "bias", "by", "class", "clip", "clippathunits", "clip-path", "clip-rule", "color", "color-interpolation", "color-interpolation-filters", "color-profile", "color-rendering", "cx", "cy", "d", "dx", "dy", "diffuseconstant", "direction", "display", "divisor", "dominant-baseline", "dur", "edgemode", "elevation", "end", "exponent", "fill", "fill-opacity", "fill-rule", "filter", "filterunits", "flood-color", "flood-opacity", "font-family", "font-size", "font-size-adjust", "font-stretch", "font-style", "font-variant", "font-weight", "fx", "fy", "g1", "g2", "glyph-name", "glyphref", "gradientunits", "gradienttransform", "height", "href", "id", "image-rendering", "in", "in2", "intercept", "k", "k1", "k2", "k3", "k4", "kerning", "keypoints", "keysplines", "keytimes", "lang", "lengthadjust", "letter-spacing", "kernelmatrix", "kernelunitlength", "lighting-color", "local", "marker-end", "marker-mid", "marker-start", "markerheight", "markerunits", "markerwidth", "maskcontentunits", "maskunits", "max", "mask", "mask-type", "media", "method", "mode", "min", "name", "numoctaves", "offset", "operator", "opacity", "order", "orient", "orientation", "origin", "overflow", "paint-order", "path", "pathlength", "patterncontentunits", "patterntransform", "patternunits", "pointer-events", "points", "preservealpha", "preserveaspectratio", "primitiveunits", "r", "rx", "ry", "radius", "refx", "refy", "repeatcount", "repeatdur", "restart", "result", "rotate", "scale", "seed", "shape-rendering", "slope", "specularconstant", "specularexponent", "spreadmethod", "startoffset", "stddeviation", "stitchtiles", "stop-color", "stop-opacity", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke", "stroke-width", "style", "surfacescale", "systemlanguage", "tabindex", "tablevalues", "targetx", "targety", "transform", "transform-origin", "text-anchor", "text-decoration", "text-orientation", "text-rendering", "textlength", "type", "u1", "u2", "unicode", "values", "vector-effect", "viewbox", "visibility", "version", "vert-adv-y", "vert-origin-x", "vert-origin-y", "width", "word-spacing", "wrap", "writing-mode", "xchannelselector", "ychannelselector", "x", "x1", "x2", "xmlns", "y", "y1", "y2", "z", "zoomandpan"]);
var mathMl = freeze(["accent", "accentunder", "align", "bevelled", "close", "columnalign", "columnlines", "columnspacing", "columnspan", "denomalign", "depth", "dir", "display", "displaystyle", "encoding", "fence", "frame", "height", "href", "id", "largeop", "length", "linethickness", "lquote", "lspace", "mathbackground", "mathcolor", "mathsize", "mathvariant", "maxsize", "minsize", "movablelimits", "notation", "numalign", "open", "rowalign", "rowlines", "rowspacing", "rowspan", "rspace", "rquote", "scriptlevel", "scriptminsize", "scriptsizemultiplier", "selection", "separator", "separators", "stretchy", "subscriptshift", "supscriptshift", "symmetric", "voffset", "width", "xmlns"]);
var xml = freeze(["xlink:href", "xml:id", "xlink:title", "xml:space", "xmlns:xlink"]);
var MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
var ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
var TMPLIT_EXPR = seal(/\${[\w\W]*/g);
var DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
var ARIA_ATTR = seal(/^aria-[\-\w]+$/);
var IS_ALLOWED_URI = seal(
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  // eslint-disable-line no-useless-escape
);
var IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
var ATTR_WHITESPACE = seal(
  /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g
  // eslint-disable-line no-control-regex
);
var DOCTYPE_NAME = seal(/^html$/i);
var CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
var ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
var COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
var FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
var SELF_CLOSING_TAG = seal(/\/>/i);
var NODE_TYPE = {
  element: 1,
  attribute: 2,
  text: 3,
  cdataSection: 4,
  entityReference: 5,
  // Deprecated
  entityNode: 6,
  // Deprecated
  processingInstruction: 7,
  comment: 8,
  document: 9,
  documentType: 10,
  documentFragment: 11,
  notation: 12
  // Deprecated
};
var LITERAL_TEXT_ELEMENT_NAMES = ["style", "script", "xmp", "iframe", "noembed", "noframes", "plaintext", "noscript"];
var LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, LITERAL_TEXT_ELEMENT_NAMES));
var LITERAL_TEXT_CLOSE = (function() {
  const map = {};
  arrayForEach(LITERAL_TEXT_ELEMENT_NAMES, (name) => {
    map[name] = seal(new RegExp("</" + name + "(?=[\\t\\n\\f\\r />])", "i"));
  });
  return freeze(map);
})();
var getGlobal = function getGlobal2() {
  return typeof window === "undefined" ? null : window;
};
var _createTrustedTypesPolicy = function _createTrustedTypesPolicy2(trustedTypes, purifyHostElement) {
  if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") {
    return null;
  }
  let suffix = null;
  const ATTR_NAME = "data-tt-policy-suffix";
  if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) {
    suffix = purifyHostElement.getAttribute(ATTR_NAME);
  }
  const policyName = "dompurify" + (suffix ? "#" + suffix : "");
  try {
    return trustedTypes.createPolicy(policyName, {
      createHTML(html2) {
        return html2;
      },
      createScriptURL(scriptUrl) {
        return scriptUrl;
      }
    });
  } catch (_2) {
    console.warn("TrustedTypes policy " + policyName + " could not be created.");
    return null;
  }
};
var _createHooksMap = function _createHooksMap2() {
  return {
    afterSanitizeAttributes: [],
    afterSanitizeElements: [],
    afterSanitizeShadowDOM: [],
    beforeSanitizeAttributes: [],
    beforeSanitizeElements: [],
    beforeSanitizeShadowDOM: [],
    uponSanitizeAttribute: [],
    uponSanitizeElement: [],
    uponSanitizeShadowNode: []
  };
};
var _resolveSetOption = function _resolveSetOption2(cfg, key, fallback, options) {
  return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
};
var _resolveObjectOption = function _resolveObjectOption2(cfg, key, makeFallback) {
  const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
  return value && typeof value === "object" ? clone(value) : makeFallback();
};
function createDOMPurify() {
  let window2 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
  const DOMPurify = (root) => createDOMPurify(root);
  DOMPurify.version = "3.4.14";
  DOMPurify.removed = [];
  if (!window2 || !window2.document || window2.document.nodeType !== NODE_TYPE.document || !window2.Element) {
    DOMPurify.isSupported = false;
    return DOMPurify;
  }
  let document2 = window2.document;
  const originalDocument = document2;
  const currentScript = originalDocument.currentScript;
  window2.DocumentFragment;
  const HTMLTemplateElement = window2.HTMLTemplateElement, Node = window2.Node, Element = window2.Element, NodeFilter = window2.NodeFilter, _window$NamedNodeMap = window2.NamedNodeMap;
  _window$NamedNodeMap === void 0 ? window2.NamedNodeMap || window2.MozNamedAttrMap : _window$NamedNodeMap;
  window2.HTMLFormElement;
  const DOMParser = window2.DOMParser, trustedTypes = window2.trustedTypes;
  const ElementPrototype = Element.prototype;
  const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
  const remove = lookupGetter(ElementPrototype, "remove");
  const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
  const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
  const getParentNode = lookupGetter(ElementPrototype, "parentNode");
  const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
  const getAttributes = lookupGetter(ElementPrototype, "attributes");
  const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
  const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
  const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
  const _readNodeType = function _readNodeType2(node) {
    return getNodeType ? getNodeType(node) : node.nodeType;
  };
  const _readNodeName = function _readNodeName2(node) {
    return getNodeName ? getNodeName(node) : node.nodeName;
  };
  if (typeof HTMLTemplateElement === "function") {
    const template = document2.createElement("template");
    if (template.content && template.content.ownerDocument) {
      document2 = template.content.ownerDocument;
    }
  }
  let trustedTypesPolicy;
  let emptyHTML = "";
  let defaultTrustedTypesPolicy;
  let defaultTrustedTypesPolicyResolved = false;
  let IN_TRUSTED_TYPES_POLICY = 0;
  const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy2() {
    if (IN_TRUSTED_TYPES_POLICY > 0) {
      throw typeErrorCreate('A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the "DOMPurify and Trusted Types" section of the README.');
    }
  };
  const _createTrustedHTML = function _createTrustedHTML2(html2) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createHTML(html2);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _createTrustedScriptURL = function _createTrustedScriptURL2(scriptUrl) {
    _assertNotInTrustedTypesPolicy();
    IN_TRUSTED_TYPES_POLICY++;
    try {
      return trustedTypesPolicy.createScriptURL(scriptUrl);
    } finally {
      IN_TRUSTED_TYPES_POLICY--;
    }
  };
  const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy2() {
    if (!defaultTrustedTypesPolicyResolved) {
      defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
      defaultTrustedTypesPolicyResolved = true;
    }
    return defaultTrustedTypesPolicy;
  };
  const _document = document2, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
  const importNode = originalDocument.importNode;
  let hooks = _createHooksMap();
  DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
  const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
  let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
  let ALLOWED_TAGS = null;
  const DEFAULT_ALLOWED_TAGS = addToSet({}, [...html$1, ...svg$1, ...svgFilters, ...mathMl$1, ...text]);
  let ALLOWED_ATTR = null;
  const DEFAULT_ALLOWED_ATTR = addToSet({}, [...html, ...svg, ...mathMl, ...xml]);
  let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
    tagNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeNameCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    allowCustomizedBuiltInElements: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: false
    }
  }));
  let FORBID_TAGS = null;
  let FORBID_ATTR = null;
  const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
    tagCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    },
    attributeCheck: {
      writable: true,
      configurable: false,
      enumerable: true,
      value: null
    }
  }));
  let ALLOW_ARIA_ATTR = true;
  let ALLOW_DATA_ATTR = true;
  let ALLOW_UNKNOWN_PROTOCOLS = false;
  let ALLOW_SELF_CLOSE_IN_ATTR = true;
  let SAFE_FOR_TEMPLATES = false;
  let SAFE_FOR_XML = true;
  let WHOLE_DOCUMENT = false;
  let SET_CONFIG = false;
  let SET_CONFIG_ALLOWED_TAGS = null;
  let SET_CONFIG_ALLOWED_ATTR = null;
  let FORCE_BODY = false;
  let RETURN_DOM = false;
  let RETURN_DOM_FRAGMENT = false;
  let RETURN_TRUSTED_TYPE = false;
  let SANITIZE_DOM = true;
  let SANITIZE_NAMED_PROPS = false;
  const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
  let KEEP_CONTENT = true;
  let IN_PLACE = false;
  let USE_PROFILES = {};
  let FORBID_CONTENTS = null;
  const DEFAULT_FORBID_CONTENTS = addToSet({}, [
    "annotation-xml",
    "audio",
    "colgroup",
    "desc",
    "foreignobject",
    "head",
    "iframe",
    "math",
    "mi",
    "mn",
    "mo",
    "ms",
    "mtext",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
    "script",
    // <selectedcontent> mirrors the selected <option>'s subtree, cloned by
    // the UA (customizable <select>) — including any on* handlers — and the
    // engine re-mirrors synchronously whenever a removal changes which
    // option/selectedcontent is current, even inside DOMPurify's inert
    // DOMParser document. Hoisting its children on removal re-inserts a fresh
    // mirror target ahead of the walk, which the engine refills, looping
    // forever (DoS) and amplifying output. Dropping its content on removal
    // (rather than hoisting) breaks that cascade; the content is a duplicate
    // of the option, which is sanitized on its own. See campaign-3 F1/F6.
    "selectedcontent",
    "style",
    "svg",
    "template",
    "thead",
    "title",
    "video",
    "xmp"
  ]);
  let DATA_URI_TAGS = null;
  const DEFAULT_DATA_URI_TAGS = addToSet({}, ["audio", "video", "img", "source", "image", "track"]);
  let URI_SAFE_ATTRIBUTES = null;
  const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, ["alt", "class", "for", "id", "label", "name", "pattern", "placeholder", "role", "summary", "title", "value", "style", "xmlns"]);
  const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
  const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
  let NAMESPACE = HTML_NAMESPACE;
  let IS_EMPTY_INPUT = false;
  let ALLOWED_NAMESPACES = null;
  const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [MATHML_NAMESPACE, SVG_NAMESPACE, HTML_NAMESPACE], stringToString);
  const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze(["mi", "mo", "mn", "ms", "mtext"]);
  let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
  const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
  let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
  const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, ["title", "style", "font", "a", "script"]);
  let PARSER_MEDIA_TYPE = null;
  const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
  const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
  let transformCaseFunc = null;
  let CONFIG = null;
  const formElement = document2.createElement("form");
  const isRegexOrFunction = function isRegexOrFunction2(testValue) {
    return testValue instanceof RegExp || testValue instanceof Function;
  };
  const _parseConfig = function _parseConfig2() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    if (CONFIG && CONFIG === cfg) {
      return;
    }
    if (!cfg || typeof cfg !== "object") {
      cfg = {};
    }
    cfg = clone(cfg);
    PARSER_MEDIA_TYPE = // eslint-disable-next-line unicorn/prefer-includes
    SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
    transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
    ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, {
      transform: transformCaseFunc
    });
    ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, {
      transform: transformCaseFunc
    });
    ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, {
      transform: stringToString
    });
    URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
      transform: transformCaseFunc,
      base: DEFAULT_URI_SAFE_ATTRIBUTES
    });
    DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
      transform: transformCaseFunc,
      base: DEFAULT_DATA_URI_TAGS
    });
    FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, {
      transform: transformCaseFunc
    });
    FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), {
      transform: transformCaseFunc
    });
    FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), {
      transform: transformCaseFunc
    });
    USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
    ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
    ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
    ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
    ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
    SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
    SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
    WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
    RETURN_DOM = cfg.RETURN_DOM || false;
    RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
    RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
    FORCE_BODY = cfg.FORCE_BODY || false;
    SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
    SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
    KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
    IN_PLACE = cfg.IN_PLACE || false;
    IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
    NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
    MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(
      cfg,
      "MATHML_TEXT_INTEGRATION_POINTS",
      () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS)
      // Default built-in map
    );
    HTML_INTEGRATION_POINTS = _resolveObjectOption(
      cfg,
      "HTML_INTEGRATION_POINTS",
      () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS)
      // Default built-in map
    );
    const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
    CUSTOM_ELEMENT_HANDLING = create(null);
    if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) {
      CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
    }
    if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) {
      CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
    }
    if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") {
      CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
    }
    seal(CUSTOM_ELEMENT_HANDLING);
    if (SAFE_FOR_TEMPLATES) {
      ALLOW_DATA_ATTR = false;
    }
    if (RETURN_DOM_FRAGMENT) {
      RETURN_DOM = true;
    }
    if (USE_PROFILES) {
      ALLOWED_TAGS = addToSet({}, text);
      ALLOWED_ATTR = create(null);
      if (USE_PROFILES.html === true) {
        addToSet(ALLOWED_TAGS, html$1);
        addToSet(ALLOWED_ATTR, html);
      }
      if (USE_PROFILES.svg === true) {
        addToSet(ALLOWED_TAGS, svg$1);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.svgFilters === true) {
        addToSet(ALLOWED_TAGS, svgFilters);
        addToSet(ALLOWED_ATTR, svg);
        addToSet(ALLOWED_ATTR, xml);
      }
      if (USE_PROFILES.mathMl === true) {
        addToSet(ALLOWED_TAGS, mathMl$1);
        addToSet(ALLOWED_ATTR, mathMl);
        addToSet(ALLOWED_ATTR, xml);
      }
    }
    EXTRA_ELEMENT_HANDLING.tagCheck = null;
    EXTRA_ELEMENT_HANDLING.attributeCheck = null;
    if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
      if (typeof cfg.ADD_TAGS === "function") {
        EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
      } else if (arrayIsArray(cfg.ADD_TAGS)) {
        if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) {
          ALLOWED_TAGS = clone(ALLOWED_TAGS);
        }
        addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
      if (typeof cfg.ADD_ATTR === "function") {
        EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
      } else if (arrayIsArray(cfg.ADD_ATTR)) {
        if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) {
          ALLOWED_ATTR = clone(ALLOWED_ATTR);
        }
        addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
      }
    }
    if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
      if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) {
        FORBID_CONTENTS = clone(FORBID_CONTENTS);
      }
      addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
    }
    if (KEEP_CONTENT) {
      ALLOWED_TAGS["#text"] = true;
    }
    if (WHOLE_DOCUMENT) {
      addToSet(ALLOWED_TAGS, ["html", "head", "body"]);
    }
    if (ALLOWED_TAGS.table) {
      addToSet(ALLOWED_TAGS, ["tbody"]);
      delete FORBID_TAGS.tbody;
    }
    if (cfg.TRUSTED_TYPES_POLICY) {
      if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") {
        throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');
      }
      if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") {
        throw typeErrorCreate('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');
      }
      const previousTrustedTypesPolicy = trustedTypesPolicy;
      trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
      try {
        emptyHTML = _createTrustedHTML("");
      } catch (error) {
        trustedTypesPolicy = previousTrustedTypesPolicy;
        throw error;
      }
    } else if (cfg.TRUSTED_TYPES_POLICY === null) {
      trustedTypesPolicy = void 0;
      emptyHTML = "";
    } else {
      if (trustedTypesPolicy === void 0) {
        trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
      }
      if (trustedTypesPolicy && typeof emptyHTML === "string") {
        emptyHTML = _createTrustedHTML("");
      }
    }
    if (freeze) {
      freeze(cfg);
    }
    CONFIG = cfg;
  };
  const ALL_SVG_TAGS = addToSet({}, [...svg$1, ...svgFilters, ...svgDisallowed]);
  const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
  const _checkSvgNamespace = function _checkSvgNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) {
      return tagName === "svg";
    }
    if (parent.namespaceURI === MATHML_NAMESPACE) {
      return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
    }
    return Boolean(ALL_SVG_TAGS[tagName]);
  };
  const _checkMathMlNamespace = function _checkMathMlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === HTML_NAMESPACE) {
      return tagName === "math";
    }
    if (parent.namespaceURI === SVG_NAMESPACE) {
      return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
    }
    return Boolean(ALL_MATHML_TAGS[tagName]);
  };
  const _checkHtmlNamespace = function _checkHtmlNamespace2(tagName, parent, parentTagName) {
    if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) {
      return false;
    }
    if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) {
      return false;
    }
    return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
  };
  const _checkValidNamespace = function _checkValidNamespace2(element) {
    let parent = getParentNode(element);
    if (!parent || !parent.tagName) {
      parent = {
        namespaceURI: NAMESPACE,
        tagName: "template"
      };
    }
    const tagName = stringToLowerCase(element.tagName);
    const parentTagName = stringToLowerCase(parent.tagName);
    if (!ALLOWED_NAMESPACES[element.namespaceURI]) {
      return false;
    }
    if (element.namespaceURI === SVG_NAMESPACE) {
      return _checkSvgNamespace(tagName, parent, parentTagName);
    }
    if (element.namespaceURI === MATHML_NAMESPACE) {
      return _checkMathMlNamespace(tagName, parent, parentTagName);
    }
    if (element.namespaceURI === HTML_NAMESPACE) {
      return _checkHtmlNamespace(tagName, parent, parentTagName);
    }
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[element.namespaceURI]) {
      return true;
    }
    return false;
  };
  const _forceRemove = function _forceRemove2(node) {
    arrayPush(DOMPurify.removed, {
      element: node
    });
    try {
      getParentNode(node).removeChild(node);
    } catch (_2) {
      remove(node);
      if (!getParentNode(node)) {
        throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
      }
    }
  };
  const _stripAttributeNode = function _stripAttributeNode2(element, attribute, name) {
    try {
      element.removeAttributeNode(attribute);
    } catch (_2) {
      try {
        element.removeAttribute(name);
      } catch (_3) {
      }
    }
  };
  const _neutralizeRoot = function _neutralizeRoot2(root) {
    _neutralizeSubtree(root);
    const childNodes = getChildNodes(root);
    if (childNodes) {
      const snapshot = [];
      arrayForEach(childNodes, (child) => {
        arrayPush(snapshot, child);
      });
      arrayForEach(snapshot, (child) => {
        try {
          remove(child);
        } catch (_2) {
        }
      });
    }
    const attributes = getAttributes(root);
    if (attributes) {
      for (let i = attributes.length - 1; i >= 0; --i) {
        const attribute = attributes[i];
        const name = attribute && attribute.name;
        if (typeof name === "string") {
          _stripAttributeNode(root, attribute, name);
        }
      }
    }
  };
  const _removeAttribute = function _removeAttribute2(name, element, attr) {
    if (!attr) {
      try {
        attr = element.getAttributeNode(name);
      } catch (_2) {
        attr = null;
      }
    }
    arrayPush(DOMPurify.removed, {
      attribute: attr || null,
      from: element
    });
    try {
      if (attr) {
        element.removeAttributeNode(attr);
      } else {
        element.removeAttribute(name);
      }
    } catch (_2) {
      try {
        element.removeAttribute(name);
      } catch (_3) {
      }
    }
    if (name === "is") {
      if (RETURN_DOM || RETURN_DOM_FRAGMENT) {
        try {
          _forceRemove(element);
        } catch (_2) {
        }
      } else {
        try {
          element.setAttribute(name, "");
        } catch (_2) {
        }
      }
    }
  };
  const _stripDisallowedAttributes = function _stripDisallowedAttributes2(element) {
    const attributes = getAttributes(element);
    if (!attributes) {
      return;
    }
    for (let i = attributes.length - 1; i >= 0; --i) {
      const attribute = attributes[i];
      const name = attribute && attribute.name;
      if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) {
        continue;
      }
      _stripAttributeNode(element, attribute, name);
    }
  };
  const _neutralizeSubtree = function _neutralizeSubtree2(root) {
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      const nodeType = _readNodeType(node);
      if (nodeType === NODE_TYPE.element) {
        _stripDisallowedAttributes(node);
      }
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push(childNodes[i]);
        }
      }
    }
  };
  const _isPatchLinkageAttribute = function _isPatchLinkageAttribute2(lcName, lcTag) {
    if (!SAFE_FOR_XML) {
      return false;
    }
    if (lcName === "patchsrc") {
      return true;
    }
    return lcName === "for" && lcTag !== "label" && lcTag !== "output";
  };
  const _neutralizePatchLinkage = function _neutralizePatchLinkage2(root) {
    if (!SAFE_FOR_XML) {
      return;
    }
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      const nodeType = _readNodeType(node);
      if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
        try {
          remove(node);
        } catch (_2) {
        }
        continue;
      }
      if (nodeType === NODE_TYPE.element) {
        const element = node;
        const lcTag = transformCaseFunc(_readNodeName(node));
        try {
          if (element.hasAttribute && element.hasAttribute("patchsrc")) {
            element.removeAttribute("patchsrc");
          }
          if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) {
            element.removeAttribute("for");
          }
        } catch (_2) {
        }
      }
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push(childNodes[i]);
        }
      }
    }
  };
  const _initDocument = function _initDocument2(dirty) {
    let doc = null;
    let leadingWhitespace = null;
    if (FORCE_BODY) {
      dirty = "<remove></remove>" + dirty;
    } else {
      const matches = stringMatch(dirty, /^[\r\n\t ]+/);
      leadingWhitespace = matches && matches[0];
    }
    if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) {
      dirty = '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>' + dirty + "</body></html>";
    }
    const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
    if (NAMESPACE === HTML_NAMESPACE) {
      try {
        doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
      } catch (_2) {
      }
    }
    if (!doc || !doc.documentElement) {
      doc = implementation.createDocument(NAMESPACE, "template", null);
      try {
        doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
      } catch (_2) {
      }
    }
    const body = doc.body || doc.documentElement;
    if (dirty && leadingWhitespace) {
      body.insertBefore(document2.createTextNode(leadingWhitespace), body.childNodes[0] || null);
    }
    if (NAMESPACE === HTML_NAMESPACE) {
      return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
    }
    return WHOLE_DOCUMENT ? doc.documentElement : body;
  };
  const _createNodeIterator = function _createNodeIterator2(root) {
    const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
    return createNodeIterator.call(
      doc || root,
      root,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION,
      null
    );
  };
  const _stripTemplateExpressions = function _stripTemplateExpressions2(value) {
    value = stringReplace(value, MUSTACHE_EXPR$1, " ");
    value = stringReplace(value, ERB_EXPR$1, " ");
    value = stringReplace(value, TMPLIT_EXPR$1, " ");
    return value;
  };
  const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
    var _node$querySelectorAl;
    node.normalize();
    const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
    const walker = createNodeIterator.call(
      doc || node,
      node,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION,
      null
    );
    let currentNode = walker.nextNode();
    while (currentNode) {
      currentNode.data = _stripTemplateExpressions(currentNode.data);
      currentNode = walker.nextNode();
    }
    const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
    if (templates) {
      arrayForEach(templates, (tmpl) => {
        if (_isDocumentFragment(tmpl.content)) {
          _scrubTemplateExpressions2(tmpl.content);
        }
      });
    }
  };
  const _isClobbered = function _isClobbered2(element) {
    const realTagName = getNodeName ? getNodeName(element) : null;
    if (typeof realTagName !== "string") {
      return false;
    }
    if (transformCaseFunc(realTagName) !== "form") {
      return false;
    }
    return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || // Realm-safe NamedNodeMap detection: equality against the cached
    // prototype getter. Clobbered .attributes (e.g. <input name="attributes">)
    // makes the direct read diverge from the cached read; a clean form
    // (same-realm OR foreign-realm) has both reads pointing at the same
    // canonical NamedNodeMap.
    element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || // NodeType clobbering probe. Cached Node.prototype.nodeType getter
    // returns the integer 1 for any Element regardless of realm; direct
    // read on a clobbered form (e.g. <input name="nodeType">) returns
    // the named child element. Cheap addition — nodeType is read from
    // an internal slot, no serialization cost — and removes a residual
    // clobbering surface used by several mXSS / PI / comment branches
    // in _sanitizeElements that compare currentNode.nodeType directly.
    element.nodeType !== getNodeType(element) || // HTMLFormElement has [LegacyOverrideBuiltIns]: a descendant named
    // "childNodes" shadows the prototype getter. Direct reads of
    // form.childNodes from a clobbered form return the named child
    // instead of the real NodeList, so any walk that reads it directly
    // skips the form's real children. Compare the direct read to the
    // cached Node.prototype getter — when the form's named-property
    // getter intercepts the read, the two values differ and we flag
    // the form. This catches every clobbering child type (input,
    // select, etc.) regardless of whether the named child happens to
    // carry a numeric .length, which a typeof-based probe would miss
    // (e.g. HTMLSelectElement.length is a defined unsigned-long).
    element.childNodes !== getChildNodes(element);
  };
  const _isDocumentFragment = function _isDocumentFragment2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) {
      return false;
    }
    try {
      return getNodeType(value) === NODE_TYPE.documentFragment;
    } catch (_2) {
      return false;
    }
  };
  const _isNode = function _isNode2(value) {
    if (!getNodeType || typeof value !== "object" || value === null) {
      return false;
    }
    try {
      return typeof getNodeType(value) === "number";
    } catch (_2) {
      return false;
    }
  };
  function _executeHooks(hooks2, currentNode, data) {
    if (hooks2.length === 0) {
      return;
    }
    arrayForEach(hooks2, (hook) => {
      hook.call(DOMPurify, currentNode, data, CONFIG);
    });
  }
  const _isUnsafeNode = function _isUnsafeNode2(currentNode, tagName) {
    if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) {
      return true;
    }
    if (SAFE_FOR_XML && currentNode.namespaceURI === HTML_NAMESPACE && LITERAL_TEXT_ELEMENTS[tagName] && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(LITERAL_TEXT_CLOSE[tagName], currentNode.textContent))) {
      return true;
    }
    if (currentNode.nodeType === NODE_TYPE.processingInstruction) {
      return true;
    }
    if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) {
      return true;
    }
    return false;
  };
  const _matchesNameCheck = function _matchesNameCheck2(check, name) {
    if (check instanceof RegExp) {
      return regExpTest(check, name);
    }
    if (check instanceof Function) {
      for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) {
        args[_key - 2] = arguments[_key];
      }
      return Boolean(check(name, ...args));
    }
    return false;
  };
  const _sanitizeDisallowedNode = function _sanitizeDisallowedNode2(currentNode, tagName, root) {
    if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) {
      return false;
    }
    if (KEEP_CONTENT && !FORBID_CONTENTS[tagName]) {
      const parentNode = getParentNode(currentNode);
      const childNodes = getChildNodes(currentNode);
      if (childNodes && parentNode) {
        const childCount = childNodes.length;
        for (let i = childCount - 1; i >= 0; --i) {
          const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
          parentNode.insertBefore(hoisted, getNextSibling(currentNode));
        }
      }
    }
    _forceRemove(currentNode);
    return true;
  };
  const _forkSharedAllowlist = function _forkSharedAllowlist2(hookList, set, defaultSet, setConfigSet) {
    if (hookList.length === 0) {
      return set;
    }
    return set === defaultSet || set === setConfigSet ? clone(set) : set;
  };
  const _handleHookDetachedNode = function _handleHookDetachedNode2(currentNode, root) {
    if (currentNode === root || getParentNode(currentNode) !== null) {
      return false;
    }
    if (IN_PLACE) {
      _neutralizeSubtree(currentNode);
    }
    return true;
  };
  const _sanitizeElements = function _sanitizeElements2(currentNode, root) {
    _executeHooks(hooks.beforeSanitizeElements, currentNode, null);
    if (_handleHookDetachedNode(currentNode, root)) {
      return true;
    }
    if (_isClobbered(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    const tagName = transformCaseFunc(_readNodeName(currentNode));
    ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
    _executeHooks(hooks.uponSanitizeElement, currentNode, {
      tagName,
      allowedTags: ALLOWED_TAGS
    });
    if (_handleHookDetachedNode(currentNode, root)) {
      return true;
    }
    if (_isUnsafeNode(currentNode, tagName)) {
      _forceRemove(currentNode);
      return true;
    }
    if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
      const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
      if (removed === false) {
        _executeHooks(hooks.afterSanitizeElements, currentNode, null);
      }
      return removed;
    }
    const nt2 = _readNodeType(currentNode);
    if (nt2 === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
      _forceRemove(currentNode);
      return true;
    }
    if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
      _forceRemove(currentNode);
      return true;
    }
    if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
      const content = _stripTemplateExpressions(currentNode.textContent);
      if (currentNode.textContent !== content) {
        arrayPush(DOMPurify.removed, {
          element: currentNode.cloneNode()
        });
        currentNode.textContent = content;
      }
    }
    _executeHooks(hooks.afterSanitizeElements, currentNode, null);
    return false;
  };
  const _isValidAttribute = function _isValidAttribute2(lcTag, lcName, value) {
    if (FORBID_ATTR[lcName]) {
      return false;
    }
    if (_isPatchLinkageAttribute(lcName, lcTag)) {
      return false;
    }
    if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document2 || value in formElement)) {
      return false;
    }
    const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
    if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) {
      return true;
    }
    if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) {
      return true;
    }
    if (!nameIsPermitted) {
      return (
        // Condition a) covers a basically valid custom element tag name whose
        // tag passes the configured tagNameCheck and whose attribute name
        // passes the configured attributeNameCheck ...
        _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || // Condition b) covers an `is` attribute whose value passes the
        // configured tagNameCheck while customized built-in elements are
        // allowed.
        lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value)
      );
    }
    if (URI_SAFE_ATTRIBUTES[lcName]) {
      return true;
    }
    if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) {
      return true;
    }
    if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) {
      return true;
    }
    if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) {
      return true;
    }
    return !value;
  };
  const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, ["annotation-xml", "color-profile", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "missing-glyph"]);
  const _isBasicCustomElement = function _isBasicCustomElement2(tagName) {
    return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
  };
  const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute2(lcTag, lcName, namespaceURI, value) {
    if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) {
      switch (trustedTypes.getAttributeType(lcTag, lcName)) {
        case "TrustedHTML": {
          return _createTrustedHTML(value);
        }
        case "TrustedScriptURL": {
          return _createTrustedScriptURL(value);
        }
      }
    }
    return value;
  };
  const _setAttributeValue = function _setAttributeValue2(currentNode, name, namespaceURI, value) {
    try {
      if (namespaceURI) {
        currentNode.setAttributeNS(namespaceURI, name, value);
      } else {
        currentNode.setAttribute(name, value);
      }
      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
      } else {
        arrayPop(DOMPurify.removed);
      }
    } catch (_2) {
      _removeAttribute(name, currentNode);
    }
  };
  const _sanitizeAttributes = function _sanitizeAttributes2(currentNode) {
    _executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
    const attributes = currentNode.attributes;
    if (!attributes || _isClobbered(currentNode)) {
      return;
    }
    ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
    const hookEvent = {
      attrName: "",
      attrValue: "",
      keepAttr: true,
      allowedAttributes: ALLOWED_ATTR,
      forceKeepAttr: void 0
    };
    let l3 = attributes.length;
    const lcTag = transformCaseFunc(currentNode.nodeName);
    while (l3--) {
      const attr = attributes[l3];
      const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
      const lcName = transformCaseFunc(name);
      const initValue = attrValue;
      let value = name === "value" ? initValue : stringTrim(initValue);
      hookEvent.attrName = lcName;
      hookEvent.attrValue = value;
      hookEvent.keepAttr = true;
      hookEvent.forceKeepAttr = void 0;
      _executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
      value = hookEvent.attrValue;
      if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
        _removeAttribute(name, currentNode, attr);
        value = SANITIZE_NAMED_PROPS_PREFIX + value;
      }
      if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (lcName === "attributename" && stringMatch(value, "href")) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (hookEvent.forceKeepAttr) {
        continue;
      }
      if (!hookEvent.keepAttr) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      if (SAFE_FOR_TEMPLATES) {
        value = _stripTemplateExpressions(value);
      }
      if (!_isValidAttribute(lcTag, lcName, value)) {
        _removeAttribute(name, currentNode, attr);
        continue;
      }
      value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
      if (value !== initValue) {
        _setAttributeValue(currentNode, name, namespaceURI, value);
      }
    }
    _executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
  };
  const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
    let shadowNode = null;
    const shadowIterator = _createNodeIterator(fragment);
    _executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
    while (shadowNode = shadowIterator.nextNode()) {
      _executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
      _sanitizeElements(shadowNode, fragment);
      _sanitizeAttributes(shadowNode);
      if (_isDocumentFragment(shadowNode.content)) {
        _sanitizeShadowDOM2(shadowNode.content);
      }
      if (_readNodeType(shadowNode) === NODE_TYPE.element) {
        const innerSr = getShadowRoot(shadowNode);
        if (_isDocumentFragment(innerSr)) {
          _sanitizeAttachedShadowRoots(innerSr);
          _sanitizeShadowDOM2(innerSr);
        }
      }
    }
    _executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
  };
  const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots2(root) {
    const stack = [{
      node: root,
      shadow: null
    }];
    while (stack.length > 0) {
      const item = stack.pop();
      if (item.shadow) {
        _sanitizeShadowDOM2(item.shadow);
        continue;
      }
      const node = item.node;
      const nodeType = _readNodeType(node);
      const isElement = nodeType === NODE_TYPE.element;
      const childNodes = getChildNodes(node);
      if (childNodes) {
        for (let i = childNodes.length - 1; i >= 0; --i) {
          stack.push({
            node: childNodes[i],
            shadow: null
          });
        }
      }
      if (isElement) {
        const rootName = getNodeName ? getNodeName(node) : null;
        if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
          const content = node.content;
          if (_isDocumentFragment(content)) {
            stack.push({
              node: content,
              shadow: null
            });
          }
        }
      }
      if (isElement) {
        const sr = getShadowRoot(node);
        if (_isDocumentFragment(sr)) {
          stack.push({
            node: null,
            shadow: sr
          }, {
            node: sr,
            shadow: null
          });
        }
      }
    }
  };
  DOMPurify.sanitize = function(dirty) {
    let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    let body = null;
    let importedNode = null;
    let currentNode = null;
    let returnNode = null;
    IS_EMPTY_INPUT = !dirty;
    if (IS_EMPTY_INPUT) {
      dirty = "<!-->";
    }
    if (typeof dirty !== "string" && !_isNode(dirty)) {
      dirty = stringifyValue(dirty);
      if (typeof dirty !== "string") {
        throw typeErrorCreate("dirty is not a string, aborting");
      }
    }
    if (!DOMPurify.isSupported) {
      return dirty;
    }
    if (SET_CONFIG) {
      ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
      ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
    } else {
      _parseConfig(cfg);
    }
    if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) {
      ALLOWED_TAGS = clone(ALLOWED_TAGS);
    }
    if (hooks.uponSanitizeAttribute.length > 0) {
      ALLOWED_ATTR = clone(ALLOWED_ATTR);
    }
    DOMPurify.removed = [];
    const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
    if (inPlace) {
      _neutralizePatchLinkage(dirty);
      const nn2 = _readNodeName(dirty);
      if (typeof nn2 === "string") {
        const tagName = transformCaseFunc(nn2);
        if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
          _neutralizeRoot(dirty);
          throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
        }
      }
      if (_isClobbered(dirty)) {
        _neutralizeRoot(dirty);
        throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
      }
      try {
        _sanitizeAttachedShadowRoots(dirty);
      } catch (error) {
        _neutralizeRoot(dirty);
        throw error;
      }
    } else if (_isNode(dirty)) {
      body = _initDocument("<!---->");
      importedNode = body.ownerDocument.importNode(dirty, true);
      if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") {
        body = importedNode;
      } else if (importedNode.nodeName === "HTML") {
        body = importedNode;
      } else {
        body.appendChild(importedNode);
      }
      _sanitizeAttachedShadowRoots(importedNode);
    } else {
      if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && // eslint-disable-next-line unicorn/prefer-includes
      dirty.indexOf("<") === -1) {
        return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
      }
      body = _initDocument(dirty);
      if (!body) {
        return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
      }
    }
    if (body && FORCE_BODY) {
      _forceRemove(body.firstChild);
    }
    const walkRoot = inPlace ? dirty : body;
    try {
      const nodeIterator = _createNodeIterator(walkRoot);
      while (currentNode = nodeIterator.nextNode()) {
        _sanitizeElements(currentNode, walkRoot);
        _sanitizeAttributes(currentNode);
        if (_isDocumentFragment(currentNode.content)) {
          _sanitizeShadowDOM2(currentNode.content);
        }
      }
    } catch (error) {
      if (inPlace) {
        _neutralizeRoot(dirty);
        arrayForEach(DOMPurify.removed, (entry) => {
          if (entry.element) {
            _neutralizeSubtree(entry.element);
          }
        });
      }
      throw error;
    }
    if (inPlace) {
      arrayForEach(DOMPurify.removed, (entry) => {
        if (entry.element) {
          _neutralizeSubtree(entry.element);
        }
      });
      if (SAFE_FOR_TEMPLATES) {
        _scrubTemplateExpressions2(dirty);
      }
      return dirty;
    }
    if (RETURN_DOM) {
      if (SAFE_FOR_TEMPLATES) {
        _scrubTemplateExpressions2(body);
      }
      if (RETURN_DOM_FRAGMENT) {
        returnNode = createDocumentFragment.call(body.ownerDocument);
        while (body.firstChild) {
          returnNode.appendChild(body.firstChild);
        }
      } else {
        returnNode = body;
      }
      if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) {
        returnNode = importNode.call(originalDocument, returnNode, true);
      }
      return returnNode;
    }
    let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
    if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) {
      serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
    }
    if (SAFE_FOR_TEMPLATES) {
      serializedHTML = _stripTemplateExpressions(serializedHTML);
    }
    return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
  };
  DOMPurify.setConfig = function() {
    let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    _parseConfig(cfg);
    SET_CONFIG = true;
    SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
    SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
  };
  DOMPurify.clearConfig = function() {
    CONFIG = null;
    SET_CONFIG = false;
    SET_CONFIG_ALLOWED_TAGS = null;
    SET_CONFIG_ALLOWED_ATTR = null;
    trustedTypesPolicy = defaultTrustedTypesPolicy;
    emptyHTML = "";
  };
  DOMPurify.isValidAttribute = function(tag, attr, value) {
    if (!CONFIG) {
      _parseConfig({});
    }
    const lcTag = transformCaseFunc(tag);
    const lcName = transformCaseFunc(attr);
    return _isValidAttribute(lcTag, lcName, value);
  };
  DOMPurify.addHook = function(entryPoint, hookFunction) {
    if (typeof hookFunction !== "function") {
      return;
    }
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return;
    }
    arrayPush(hooks[entryPoint], hookFunction);
  };
  DOMPurify.removeHook = function(entryPoint, hookFunction) {
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return void 0;
    }
    if (hookFunction !== void 0) {
      const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
      return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
    }
    return arrayPop(hooks[entryPoint]);
  };
  DOMPurify.removeHooks = function(entryPoint) {
    if (!objectHasOwnProperty(hooks, entryPoint)) {
      return;
    }
    hooks[entryPoint] = [];
  };
  DOMPurify.removeAllHooks = function() {
    hooks = _createHooksMap();
  };
  return DOMPurify;
}
var purify = createDOMPurify();

// node_modules/marked/lib/marked.esm.js
function C() {
  return { async: false, breaks: false, extensions: null, gfm: true, hooks: null, pedantic: false, renderer: null, silent: false, tokenizer: null, walkTokens: null };
}
var R = C();
function j(l3) {
  R = l3;
}
var z = { exec: () => null };
function A(l3) {
  let e = [];
  return (t) => {
    let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
    return s || (s = l3(n), e[n] = s), s;
  };
}
function d(l3, e = "") {
  let t = typeof l3 == "string" ? l3 : l3.source, n = { replace: (s, r) => {
    let i = typeof r == "string" ? r : r.source;
    return i = i.replace(m.caret, "$1"), t = t.replace(s, i), n;
  }, getRegex: () => new RegExp(t, e) };
  return n;
}
var Te = ((l3 = "") => {
  try {
    return !!new RegExp("(?<=1)(?<!1)" + l3);
  } catch {
    return false;
  }
})();
var m = { codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm, outputLinkReplace: /\\([\[\]])/g, indentCodeCompensation: /^(\s+)(?:```)/, beginningSpace: /^\s+/, endingHash: /#$/, startingSpaceChar: /^ /, endingSpaceChar: / $/, nonSpaceChar: /[^ ]/, newLineCharGlobal: /\n/g, tabCharGlobal: /\t/g, multipleSpaceGlobal: /\s+/g, blankLine: /^[ \t]*$/, doubleBlankLine: /\n[ \t]*\n[ \t]*$/, blockquoteStart: /^ {0,3}>/, blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g, blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm, listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g, listIsTask: /^\[[ xX]\] +\S/, listReplaceTask: /^\[[ xX]\] +/, listTaskCheckbox: /\[[ xX]\]/, anyLine: /\n.*\n/, hrefBrackets: /^<(.*)>$/, tableDelimiter: /[:|]/, tableAlignChars: /^\||\| *$/g, tableRowBlankLine: /\n[ \t]*$/, tableAlignRight: /^ *-+: *$/, tableAlignCenter: /^ *:-+: *$/, tableAlignLeft: /^ *:-+ *$/, startATag: /^<a /i, endATag: /^<\/a>/i, startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i, endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i, startAngleBracket: /^</, endAngleBracket: />$/, pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/, unicodeAlphaNumeric: /[\p{L}\p{N}]/u, escapeTest: /[&<>"']/, escapeReplace: /[&<>"']/g, escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/, escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, caret: /(^|[^\[])\^/g, percentDecode: /%25/g, findPipe: /\|/g, splitPipe: / \|/, slashPipe: /\\\|/g, carriageReturn: /\r\n|\r/g, spaceLine: /^ +$/gm, notSpaceStart: /^\S*/, endingNewline: /\n$/, listItemRegex: (l3) => new RegExp(`^( {0,3}${l3})((?:[	 ][^\\n]*)?(?:\\n|$))`), nextBulletRegex: A((l3) => new RegExp(`^ {0,${l3}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)), hrRegex: A((l3) => new RegExp(`^ {0,${l3}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`)), fencesBeginRegex: A((l3) => new RegExp(`^ {0,${l3}}(?:\`\`\`|~~~)`)), headingBeginRegex: A((l3) => new RegExp(`^ {0,${l3}}#`)), htmlBeginRegex: A((l3) => new RegExp(`^ {0,${l3}}<(?:[a-z].*>|!--)`, "i")), blockquoteBeginRegex: A((l3) => new RegExp(`^ {0,${l3}}>`)) };
var Oe = /^(?:[ \t]*(?:\n|$))+/;
var we = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ye = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var q = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Pe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var U = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ae = d(oe).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Se = d(oe).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var K = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
var _e = /^[^\n]+/;
var W = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var $e = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", W).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var Le = d(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, U).getRegex();
var Q = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var X = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var Me = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", X).replace("tag", Q).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var le = (l3) => d(K).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l3).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
var ze = le(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
var Ee = le(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
var Ce = d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Ee).getRegex();
var J = { blockquote: Ce, code: we, def: $e, fences: ye, heading: Pe, hr: q, html: Me, lheading: ae, list: Le, newline: Oe, paragraph: ze, table: z, text: _e };
var se = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
var Ae = { ...J, lheading: Se, table: se, paragraph: d(K).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", se).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex() };
var Ie = { ...J, html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", X).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(), def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/, heading: /^(#{1,6})(.*)(?:\n+|$)/, fences: z, lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/, paragraph: d(K).replace("hr", q).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ae).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex() };
var Be = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var De = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var pe = /^( {2,}|\\)\n(?!\s*$)/;
var qe = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var _ = /[\p{P}\p{S}]/u;
var I = /[\s\p{P}\p{S}]/u;
var v = /[^\s\p{P}\p{S}]/u;
var ve = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, I).getRegex();
var He = /[\p{Pi}\p{Ps}"']/u;
var ue = /(?!~)[\p{P}\p{S}]/u;
var Ze = /(?!~)[\s\p{P}\p{S}]/u;
var Ge = /(?:[^\s\p{P}\p{S}]|~)/u;
var Qe = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Te ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ce = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Ne = d(ce, "u").replace(/punct/g, _).getRegex();
var je = d(ce, "u").replace(/punct/g, ue).getRegex();
var Fe = /^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/;
var Ue = d(Fe, "u").replace(/openQuote/g, He).replace(/punct/g, _).getRegex();
var he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ke = d(he, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
var We = d(he, "gu").replace(/notPunctSpace/g, Ge).replace(/punctSpace/g, Ze).replace(/punct/g, ue).getRegex();
var Xe = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)";
var Je = d(Xe, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
var Ve = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
var Ye = "^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)";
var et = d(Ye, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
var tt = d(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, _).getRegex();
var nt = "^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)";
var rt = d(nt, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, I).replace(/punct/g, _).getRegex();
var st = d(/\\(punct)/, "gu").replace(/punct/g, _).getRegex();
var it = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var ot = d(X).replace("(?:-->|$)", "-->").getRegex();
var at = d("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ot).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var G = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
var lt = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", G).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var de = d(/^!?\[(label)\]\[(ref)\]/).replace("label", G).replace("ref", W).getRegex();
var ke = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", W).getRegex();
var pt = d("reflink|nolink(?!\\()", "g").replace("reflink", de).replace("nolink", ke).getRegex();
var ie = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var V = { _backpedal: z, anyPunctuation: st, autolink: it, blockSkip: Qe, br: pe, code: De, del: z, delLDelim: z, delRDelim: z, emStrongLDelim: Ne, emStrongRDelimAst: Ke, emStrongRDelimUnd: Ve, escape: Be, link: lt, nolink: ke, punctuation: ve, reflink: de, reflinkSearch: pt, tag: at, text: qe, url: z };
var ut = { ...V, emStrongLDelim: Ue, emStrongRDelimAst: Je, emStrongRDelimUnd: et, link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", G).getRegex(), reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", G).getRegex() };
var F = { ...V, emStrongRDelimAst: We, emStrongLDelim: je, delLDelim: tt, delRDelim: rt, url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ie).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(), _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/, del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/, text: d(/^(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ie).getRegex() };
var ct = { ...F, br: d(pe).replace("{2,}", "*").getRegex(), text: d(F.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex() };
var H = { normal: J, gfm: Ae, pedantic: Ie };
var B = { normal: V, gfm: F, breaks: ct, pedantic: ut };
var ht = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
var ge = (l3) => ht[l3];
function O(l3, e) {
  if (e) {
    if (m.escapeTest.test(l3)) return l3.replace(m.escapeReplace, ge);
  } else if (m.escapeTestNoEncode.test(l3)) return l3.replace(m.escapeReplaceNoEncode, ge);
  return l3;
}
function Y(l3) {
  try {
    l3 = encodeURI(l3).replace(m.percentDecode, "%");
  } catch {
    return null;
  }
  return l3;
}
function ee(l3, e) {
  let t = l3.replace(m.findPipe, (r, i, o) => {
    let p = false, a = i;
    for (; --a >= 0 && o[a] === "\\"; ) p = !p;
    return p ? "|" : " |";
  }), n = t.split(m.splitPipe), s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
  else for (; n.length < e; ) n.push("");
  for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
  return n;
}
function $(l3, e, t) {
  let n = l3.length;
  if (n === 0) return "";
  let s = 0;
  for (; s < n; ) {
    let r = l3.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return l3.slice(0, n - s);
}
function te(l3) {
  let e = l3.split(`
`), t = e.length - 1;
  for (; t >= 0 && m.blankLine.test(e[t]); ) t--;
  return e.length - t <= 2 ? l3 : e.slice(0, t + 1).join(`
`);
}
function fe(l3, e) {
  if (l3.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < l3.length; n++) if (l3[n] === "\\") n++;
  else if (l3[n] === e[0]) t++;
  else if (l3[n] === e[1] && (t--, t < 0)) return n;
  return t > 0 ? -2 : -1;
}
function me(l3, e = 0) {
  let t = e, n = "";
  for (let s of l3) if (s === "	") {
    let r = 4 - t % 4;
    n += " ".repeat(r), t += r;
  } else n += s, t++;
  return n;
}
function xe(l3, e, t, n, s) {
  let r = e.href, i = e.title || null, o = l3[1].replace(s.other.outputLinkReplace, "$1");
  n.state.inLink = true;
  let p = { type: l3[0].charAt(0) === "!" ? "image" : "link", raw: t, href: r, title: i, text: o, tokens: n.inlineTokens(o) };
  return n.state.inLink = false, p;
}
function dt(l3, e, t) {
  let n = l3.match(t.other.indentCodeCompensation);
  if (n === null) return e;
  let s = n[1];
  return e.split(`
`).map((r) => {
    let i = r.match(t.other.beginningSpace);
    if (i === null) return r;
    let [o] = i;
    return o.length >= s.length ? r.slice(s.length) : r;
  }).join(`
`);
}
var y = class {
  options;
  rules;
  lexer;
  constructor(e) {
    this.options = e || R;
  }
  space(e) {
    let t = this.rules.block.newline.exec(e);
    if (t && t[0].length > 0) return { type: "space", raw: t[0] };
  }
  code(e) {
    let t = this.rules.block.code.exec(e);
    if (t) {
      let n = this.options.pedantic ? t[0] : te(t[0]), s = n.replace(this.rules.other.codeRemoveIndent, "");
      return { type: "code", raw: n, codeBlockStyle: "indented", text: s };
    }
  }
  fences(e) {
    let t = this.rules.block.fences.exec(e);
    if (t) {
      let n = t[0], s = dt(n, t[3] || "", this.rules);
      return { type: "code", raw: n, lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2], text: s };
    }
  }
  heading(e) {
    let t = this.rules.block.heading.exec(e);
    if (t) {
      let n = t[2].trim();
      if (this.rules.other.endingHash.test(n)) {
        let s = $(n, "#");
        (this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
      }
      return { type: "heading", raw: $(t[0], `
`), depth: t[1].length, text: n, tokens: this.lexer.inline(n) };
    }
  }
  hr(e) {
    let t = this.rules.block.hr.exec(e);
    if (t) return { type: "hr", raw: $(t[0], `
`) };
  }
  blockquote(e) {
    let t = this.rules.block.blockquote.exec(e);
    if (t) {
      let n = $(t[0], `
`).split(`
`), s = "", r = "", i = [];
      for (; n.length > 0; ) {
        let o = false, p = [], a;
        for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) p.push(n[a]), o = true;
        else if (!o) p.push(n[a]);
        else break;
        n = n.slice(a);
        let u = p.join(`
`), c = u.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
        s = s ? `${s}
${u}` : u, r = r ? `${r}
${c}` : c;
        let h = this.lexer.state.top;
        if (this.lexer.state.top = true, this.lexer.blockTokens(c, i, true), this.lexer.state.top = h, n.length === 0) break;
        let k = i.at(-1);
        if (k?.type === "code") break;
        if (k?.type === "blockquote") {
          let T = k, g = n.join(`
`), w = T.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), M = this.blockquote(w);
          i[i.length - 1] = M, s = `${s}
${g}`, r = r.substring(0, r.length - T.text.length) + M.text;
          break;
        } else if (k?.type === "list") {
          let T = k, g = T.raw + `
` + n.join(`
`), w = this.list(g);
          i[i.length - 1] = w, s = s.substring(0, s.length - k.raw.length) + w.raw, r = r.substring(0, r.length - T.raw.length) + w.raw, n = g.substring(i.at(-1).raw.length).split(`
`);
          continue;
        }
      }
      return { type: "blockquote", raw: s, tokens: i, text: r };
    }
  }
  list(e) {
    let t = this.rules.block.list.exec(e);
    if (t) {
      let n = t[1].trim(), s = n.length > 1, r = { type: "list", raw: "", ordered: s, start: s ? +n.slice(0, -1) : "", loose: false, items: [] };
      n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
      let i = this.rules.other.listItemRegex(n), o = false;
      for (; e; ) {
        let a = false, u = "", c = "";
        if (!(t = i.exec(e)) || this.rules.block.hr.test(e)) break;
        u = t[0], e = e.substring(u.length);
        let h = me(t[2].split(`
`, 1)[0], t[1].length), k = e.split(`
`, 1)[0], T = !h.trim(), g = 0;
        if (this.options.pedantic ? (g = 2, c = h.trimStart()) : T ? g = t[1].length + 1 : (g = h.search(this.rules.other.nonSpaceChar), g = g > 4 ? 1 : g, c = h.slice(g), g += t[1].length), T && this.rules.other.blankLine.test(k) && (u += k + `
`, e = e.substring(k.length + 1), a = true), !a) {
          let w = this.rules.other.nextBulletRegex(g), M = this.rules.other.hrRegex(g), ne = this.rules.other.fencesBeginRegex(g), re = this.rules.other.headingBeginRegex(g), be = this.rules.other.htmlBeginRegex(g), Re = this.rules.other.blockquoteBeginRegex(g);
          for (; e; ) {
            let N = e.split(`
`, 1)[0], D;
            if (k = N, this.options.pedantic ? (k = k.replace(this.rules.other.listReplaceNesting, "  "), D = k) : D = k.replace(this.rules.other.tabCharGlobal, "    "), ne.test(k) || re.test(k) || be.test(k) || Re.test(k) || w.test(k) || M.test(k)) break;
            if (D.search(this.rules.other.nonSpaceChar) >= g || !k.trim()) c += `
` + D.slice(g);
            else {
              if (T || h.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne.test(h) || re.test(h) || M.test(h)) break;
              c += `
` + k;
            }
            T = !k.trim(), u += N + `
`, e = e.substring(N.length + 1), h = D.slice(g);
          }
        }
        r.loose || (o ? r.loose = true : this.rules.other.doubleBlankLine.test(u) && (o = true)), r.items.push({ type: "list_item", raw: u, task: !!this.options.gfm && this.rules.other.listIsTask.test(c), loose: false, text: c, tokens: [] }), r.raw += u;
      }
      let p = r.items.at(-1);
      if (p) p.raw = p.raw.trimEnd(), p.text = p.text.trimEnd();
      else return;
      r.raw = r.raw.trimEnd();
      for (let a of r.items) if (this.lexer.state.top = false, a.tokens = this.lexer.blockTokens(a.text, []), !r.loose) {
        let u = a.tokens.filter((h) => h.type === "space"), c = u.length > 0 && u.some((h) => this.rules.other.anyLine.test(h.raw));
        r.loose = c;
      }
      for (let a of r.items) {
        let u = a.tokens[0];
        if (a.task && (u?.type === "text" || u?.type === "paragraph")) {
          a.text = a.text.replace(this.rules.other.listReplaceTask, ""), u.raw = u.raw.replace(this.rules.other.listReplaceTask, ""), u.text = u.text.replace(this.rules.other.listReplaceTask, "");
          for (let h = this.lexer.inlineQueue.length - 1; h >= 0; h--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[h].src)) {
            this.lexer.inlineQueue[h].src = this.lexer.inlineQueue[h].src.replace(this.rules.other.listReplaceTask, "");
            break;
          }
          let c = this.rules.other.listTaskCheckbox.exec(a.raw);
          if (c) {
            let h = { type: "checkbox", raw: c[0] + " ", checked: c[0] !== "[ ]" };
            a.checked = h.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = h.raw + a.tokens[0].raw, a.tokens[0].text = h.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(h)) : a.tokens.unshift({ type: "paragraph", raw: h.raw, text: h.raw, tokens: [h] }) : a.tokens.unshift(h);
          }
        } else a.task && (a.task = false);
      }
      if (r.loose) for (let a of r.items) {
        a.loose = true;
        for (let u of a.tokens) u.type === "text" && (u.type = "paragraph");
      }
      return r;
    }
  }
  html(e) {
    let t = this.rules.block.html.exec(e);
    if (t) {
      let n = te(t[0]);
      return { type: "html", block: true, raw: n, pre: t[1] === "pre" || t[1] === "script" || t[1] === "style", text: n };
    }
  }
  def(e) {
    let t = this.rules.block.def.exec(e);
    if (t) {
      let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
      return { type: "def", tag: n, raw: $(t[0], `
`), href: s, title: r };
    }
  }
  table(e) {
    let t = this.rules.block.table.exec(e);
    if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
    let n = ee(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], i = { type: "table", raw: $(t[0], `
`), header: [], align: [], rows: [] };
    if (n.length === s.length) {
      for (let o of s) this.rules.other.tableAlignRight.test(o) ? i.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i.align.push("left") : i.align.push(null);
      for (let o = 0; o < n.length; o++) i.header.push({ text: n[o], tokens: this.lexer.inline(n[o]), header: true, align: i.align[o] });
      for (let o of r) i.rows.push(ee(o, i.header.length).map((p, a) => ({ text: p, tokens: this.lexer.inline(p), header: false, align: i.align[a] })));
      return i;
    }
  }
  lheading(e) {
    let t = this.rules.block.lheading.exec(e);
    if (t) {
      let n = t[1].trim();
      return { type: "heading", raw: $(t[0], `
`), depth: t[2].charAt(0) === "=" ? 1 : 2, text: n, tokens: this.lexer.inline(n) };
    }
  }
  paragraph(e) {
    let t = this.rules.block.paragraph.exec(e);
    if (t) {
      let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
      return { type: "paragraph", raw: t[0], text: n, tokens: this.lexer.inline(n) };
    }
  }
  text(e) {
    let t = this.rules.block.text.exec(e);
    if (t) return { type: "text", raw: t[0], text: t[0], tokens: this.lexer.inline(t[0]) };
  }
  escape(e) {
    let t = this.rules.inline.escape.exec(e);
    if (t) return { type: "escape", raw: t[0], text: t[1] };
  }
  tag(e) {
    let t = this.rules.inline.tag.exec(e);
    if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = true : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = false), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = true : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = false), { type: "html", raw: t[0], inLink: this.lexer.state.inLink, inRawBlock: this.lexer.state.inRawBlock, block: false, text: t[0] };
  }
  link(e) {
    let t = this.rules.inline.link.exec(e);
    if (t) {
      let n = t[2].trim();
      if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
        if (!this.rules.other.endAngleBracket.test(n)) return;
        let i = $(n.slice(0, -1), "\\");
        if ((n.length - i.length) % 2 === 0) return;
      } else {
        let i = fe(t[2], "()");
        if (i === -2) return;
        if (i > -1) {
          let p = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
          t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, p).trim(), t[3] = "";
        }
      }
      let s = t[2], r = "";
      if (this.options.pedantic) {
        let i = this.rules.other.pedanticHrefTitle.exec(s);
        i && (s = i[1], r = i[3]);
      } else r = t[3] ? t[3].slice(1, -1) : "";
      return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe(t, { href: s && s.replace(this.rules.inline.anyPunctuation, "$1"), title: r && r.replace(this.rules.inline.anyPunctuation, "$1") }, t[0], this.lexer, this.rules);
    }
  }
  reflink(e, t) {
    let n;
    if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
      let s = (n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " "), r = t[s.toLowerCase()];
      if (!r) {
        let i = n[0].charAt(0);
        return { type: "text", raw: i, text: i };
      }
      return xe(n, r, n[0], this.lexer, this.rules);
    }
  }
  emStrong(e, t, n = "") {
    let s = this.rules.inline.emStrongLDelim.exec(e);
    if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
    if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, p, a = i, u = 0, c = s[0][0], h = n === c, k = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      for (k.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = k.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
        if (p = [...o].length, s[3] || s[4]) {
          a += p;
          continue;
        } else if (s[5] || s[6]) {
          if (i % 3 && !((i + p) % 3)) {
            u += p;
            continue;
          }
          if (h) break;
        }
        if (a -= p, a > 0) continue;
        p = Math.min(p, p + a + u);
        let T = [...s[0]][0].length, g = e.slice(0, i + s.index + T + p);
        if (Math.min(i, p) % 2) {
          let M = g.slice(1, -1);
          return { type: "em", raw: g, text: M, tokens: this.lexer.inlineTokens(M) };
        }
        let w = g.slice(2, -2);
        return { type: "strong", raw: g, text: w, tokens: this.lexer.inlineTokens(w) };
      }
    }
  }
  codespan(e) {
    let t = this.rules.inline.code.exec(e);
    if (t) {
      let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
      return s && r && (n = n.substring(1, n.length - 1)), { type: "codespan", raw: t[0], text: n };
    }
  }
  br(e) {
    let t = this.rules.inline.br.exec(e);
    if (t) return { type: "br", raw: t[0] };
  }
  del(e, t, n = "") {
    let s = this.rules.inline.delLDelim.exec(e);
    if (!s) return;
    if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
      let i = [...s[0]].length - 1, o, p, a = i, u = this.rules.inline.delRDelim;
      for (u.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = u.exec(t)) !== null; ) {
        if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (p = [...o].length, p !== i)) continue;
        if (s[3] || s[4]) {
          a += p;
          continue;
        }
        if (a -= p, a > 0) continue;
        p = Math.min(p, p + a);
        let c = [...s[0]][0].length, h = e.slice(0, i + s.index + c + p), k = h.slice(i, -i);
        return { type: "del", raw: h, text: k, tokens: this.lexer.inlineTokens(k) };
      }
    }
  }
  autolink(e) {
    let t = this.rules.inline.autolink.exec(e);
    if (t) {
      let n, s;
      return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  url(e) {
    let t;
    if (t = this.rules.inline.url.exec(e)) {
      let n, s;
      if (t[2] === "@") n = t[0], s = "mailto:" + n;
      else {
        let r;
        do
          r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
        while (r !== t[0]);
        n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
      }
      return { type: "link", raw: t[0], text: n, href: s, tokens: [{ type: "text", raw: n, text: n }] };
    }
  }
  inlineText(e) {
    let t = this.rules.inline.text.exec(e);
    if (t) {
      let n = this.lexer.state.inRawBlock;
      return { type: "text", raw: t[0], text: t[0], escaped: n };
    }
  }
};
var x = class l {
  tokens;
  options;
  state;
  inlineQueue;
  tokenizer;
  constructor(e) {
    this.tokens = [], this.tokens.links = /* @__PURE__ */ Object.create(null), this.options = e || R, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = { inLink: false, inRawBlock: false, top: true };
    let t = { other: m, block: H.normal, inline: B.normal };
    this.options.pedantic ? (t.block = H.pedantic, t.inline = B.pedantic) : this.options.gfm && (t.block = H.gfm, this.options.breaks ? t.inline = B.breaks : t.inline = B.gfm), this.tokenizer.rules = t;
  }
  static get rules() {
    return { block: H, inline: B };
  }
  static lex(e, t) {
    return new l(t).lex(e);
  }
  static lexInline(e, t) {
    return new l(t).inlineTokens(e);
  }
  lex(e) {
    e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
    for (let t = 0; t < this.inlineQueue.length; t++) {
      let n = this.inlineQueue[t];
      this.inlineTokens(n.src, n.tokens);
    }
    return this.inlineQueue = [], this.tokens;
  }
  blockTokens(e, t = [], n = false) {
    this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
    let s = 1 / 0;
    for (; e; ) {
      if (e.length < s) s = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      let r;
      if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), true) : false)) continue;
      if (r = this.tokenizer.space(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        r.raw.length === 1 && o !== void 0 ? o.raw += `
` : t.push(r);
        continue;
      }
      if (r = this.tokenizer.code(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (r = this.tokenizer.fences(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.heading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.hr(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.blockquote(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.list(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.html(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.def(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = { href: r.href, title: r.title }, t.push(r));
        continue;
      }
      if (r = this.tokenizer.table(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      if (r = this.tokenizer.lheading(e)) {
        e = e.substring(r.raw.length), t.push(r);
        continue;
      }
      let i = e;
      if (this.options.extensions?.startBlock) {
        let o = 1 / 0, p = e.slice(1), a;
        this.options.extensions.startBlock.forEach((u) => {
          a = u.call({ lexer: this }, p), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
        }), o < 1 / 0 && o >= 0 && (i = e.substring(0, o + 1));
      }
      if (this.state.top && (r = this.tokenizer.paragraph(i))) {
        let o = t.at(-1);
        n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
        continue;
      }
      if (r = this.tokenizer.text(e)) {
        e = e.substring(r.raw.length);
        let o = t.at(-1);
        o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return this.state.top = true, t;
  }
  inline(e, t = []) {
    return this.inlineQueue.push({ src: e, tokens: t }), t;
  }
  inlineTokens(e, t = []) {
    this.tokenizer.lexer = this;
    let n = e;
    if (this.tokens.links) {
      let o = Object.keys(this.tokens.links);
      o.length > 0 && (n = n.replace(this.tokenizer.rules.inline.reflinkSearch, (p) => o.includes(p.slice(p.lastIndexOf("[") + 1, -1)) ? "[" + "a".repeat(p.length - 2) + "]" : p));
    }
    n = n.replace(this.tokenizer.rules.inline.anyPunctuation, (o) => "+".repeat(o.length)), n = n.replace(this.tokenizer.rules.inline.blockSkip, (o, p, a) => {
      let u = a ? a.length : 0;
      return o.slice(0, u) + "[" + "a".repeat(o.length - u - 2) + "]";
    }), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
    let s = false, r = "", i = 1 / 0;
    for (; e; ) {
      if (e.length < i) i = e.length;
      else {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
      s || (r = ""), s = false;
      let o;
      if (this.options.extensions?.inline?.some((a) => (o = a.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), true) : false)) continue;
      if (o = this.tokenizer.escape(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.tag(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.link(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.reflink(e, this.tokens.links)) {
        e = e.substring(o.raw.length);
        let a = t.at(-1);
        o.type === "text" && a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
        continue;
      }
      if (o = this.tokenizer.emStrong(e, n, r)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.codespan(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.br(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.del(e, n, r)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (o = this.tokenizer.autolink(e)) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      if (!this.state.inLink && (o = this.tokenizer.url(e))) {
        e = e.substring(o.raw.length), t.push(o);
        continue;
      }
      let p = e;
      if (this.options.extensions?.startInline) {
        let a = 1 / 0, u = e.slice(1), c;
        this.options.extensions.startInline.forEach((h) => {
          c = h.call({ lexer: this }, u), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
        }), a < 1 / 0 && a >= 0 && (p = e.substring(0, a + 1));
      }
      if (o = this.tokenizer.inlineText(p)) {
        e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (r = o.raw.slice(-1)), s = true;
        let a = t.at(-1);
        a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
        continue;
      }
      if (e) {
        this.infiniteLoopError(e.charCodeAt(0));
        break;
      }
    }
    return t;
  }
  infiniteLoopError(e) {
    let t = "Infinite loop on byte: " + e;
    if (this.options.silent) console.error(t);
    else throw new Error(t);
  }
};
var P = class {
  options;
  parser;
  constructor(e) {
    this.options = e || R;
  }
  space(e) {
    return "";
  }
  code({ text: e, lang: t, escaped: n }) {
    let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + `
`;
    return s ? '<pre><code class="language-' + O(s) + '">' + (n ? r : O(r, true)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, true)) + `</code></pre>
`;
  }
  blockquote({ tokens: e }) {
    return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
  }
  html({ text: e }) {
    return e;
  }
  def(e) {
    return "";
  }
  heading({ tokens: e, depth: t }) {
    return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
  }
  hr(e) {
    return `<hr>
`;
  }
  list(e) {
    let t = e.ordered, n = e.start, s = "";
    for (let o = 0; o < e.items.length; o++) {
      let p = e.items[o];
      s += this.listitem(p);
    }
    let r = t ? "ol" : "ul", i = t && n !== 1 ? ' start="' + n + '"' : "";
    return "<" + r + i + `>
` + s + "</" + r + `>
`;
  }
  listitem(e) {
    return `<li>${this.parser.parse(e.tokens)}</li>
`;
  }
  checkbox({ checked: e }) {
    return "<input " + (e ? 'checked="" ' : "") + 'disabled="" type="checkbox"> ';
  }
  paragraph({ tokens: e }) {
    return `<p>${this.parser.parseInline(e)}</p>
`;
  }
  table(e) {
    let t = "", n = "";
    for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
    t += this.tablerow({ text: n });
    let s = "";
    for (let r = 0; r < e.rows.length; r++) {
      let i = e.rows[r];
      n = "";
      for (let o = 0; o < i.length; o++) n += this.tablecell(i[o]);
      s += this.tablerow({ text: n });
    }
    return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
  }
  tablerow({ text: e }) {
    return `<tr>
${e}</tr>
`;
  }
  tablecell(e) {
    let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
    return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
  }
  strong({ tokens: e }) {
    return `<strong>${this.parser.parseInline(e)}</strong>`;
  }
  em({ tokens: e }) {
    return `<em>${this.parser.parseInline(e)}</em>`;
  }
  codespan({ text: e }) {
    return `<code>${O(e, true)}</code>`;
  }
  br(e) {
    return "<br>";
  }
  del({ tokens: e }) {
    return `<del>${this.parser.parseInline(e)}</del>`;
  }
  link({ href: e, title: t, tokens: n }) {
    let s = this.parser.parseInline(n), r = Y(e);
    if (r === null) return s;
    e = r;
    let i = '<a href="' + e + '"';
    return t && (i += ' title="' + O(t) + '"'), i += ">" + s + "</a>", i;
  }
  image({ href: e, title: t, text: n, tokens: s }) {
    s && (n = this.parser.parseInline(s, this.parser.textRenderer));
    let r = Y(e);
    if (r === null) return O(n);
    e = r;
    let i = `<img src="${e}" alt="${O(n)}"`;
    return t && (i += ` title="${O(t)}"`), i += ">", i;
  }
  text(e) {
    return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
  }
};
var L = class {
  strong({ text: e }) {
    return e;
  }
  em({ text: e }) {
    return e;
  }
  codespan({ text: e }) {
    return e;
  }
  del({ text: e }) {
    return e;
  }
  html({ text: e }) {
    return e;
  }
  text({ text: e }) {
    return e;
  }
  link({ text: e }) {
    return "" + e;
  }
  image({ text: e }) {
    return "" + e;
  }
  br() {
    return "";
  }
  checkbox({ raw: e }) {
    return e;
  }
};
var b = class l2 {
  options;
  renderer;
  textRenderer;
  constructor(e) {
    this.options = e || R, this.options.renderer = this.options.renderer || new P(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
  }
  static parse(e, t) {
    return new l2(t).parse(e);
  }
  static parseInline(e, t) {
    return new l2(t).parseInline(e);
  }
  parse(e) {
    this.renderer.parser = this;
    let t = "";
    for (let n = 0; n < e.length; n++) {
      let s = e[n];
      if (this.options.extensions?.renderers?.[s.type]) {
        let i = s, o = this.options.extensions.renderers[i.type].call({ parser: this }, i);
        if (o !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "checkbox", "html", "def", "paragraph", "text"].includes(i.type)) {
          t += o || "";
          continue;
        }
      }
      let r = s;
      switch (r.type) {
        case "space": {
          t += this.renderer.space(r);
          break;
        }
        case "hr": {
          t += this.renderer.hr(r);
          break;
        }
        case "heading": {
          t += this.renderer.heading(r);
          break;
        }
        case "code": {
          t += this.renderer.code(r);
          break;
        }
        case "table": {
          t += this.renderer.table(r);
          break;
        }
        case "blockquote": {
          t += this.renderer.blockquote(r);
          break;
        }
        case "list": {
          t += this.renderer.list(r);
          break;
        }
        case "checkbox": {
          t += this.renderer.checkbox(r);
          break;
        }
        case "html": {
          t += this.renderer.html(r);
          break;
        }
        case "def": {
          t += this.renderer.def(r);
          break;
        }
        case "paragraph": {
          t += this.renderer.paragraph(r);
          break;
        }
        case "text": {
          t += this.renderer.text(r);
          break;
        }
        default: {
          let i = 'Token with "' + r.type + '" type was not found.';
          if (this.options.silent) return console.error(i), "";
          throw new Error(i);
        }
      }
    }
    return t;
  }
  parseInline(e, t = this.renderer) {
    this.renderer.parser = this;
    let n = "";
    for (let s = 0; s < e.length; s++) {
      let r = e[s];
      if (this.options.extensions?.renderers?.[r.type]) {
        let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
        if (o !== false || !["escape", "html", "link", "image", "checkbox", "strong", "em", "codespan", "br", "del", "text"].includes(r.type)) {
          n += o || "";
          continue;
        }
      }
      let i = r;
      switch (i.type) {
        case "escape": {
          n += t.text(i);
          break;
        }
        case "html": {
          n += t.html(i);
          break;
        }
        case "link": {
          n += t.link(i);
          break;
        }
        case "image": {
          n += t.image(i);
          break;
        }
        case "checkbox": {
          n += t.checkbox(i);
          break;
        }
        case "strong": {
          n += t.strong(i);
          break;
        }
        case "em": {
          n += t.em(i);
          break;
        }
        case "codespan": {
          n += t.codespan(i);
          break;
        }
        case "br": {
          n += t.br(i);
          break;
        }
        case "del": {
          n += t.del(i);
          break;
        }
        case "text": {
          n += t.text(i);
          break;
        }
        default: {
          let o = 'Token with "' + i.type + '" type was not found.';
          if (this.options.silent) return console.error(o), "";
          throw new Error(o);
        }
      }
    }
    return n;
  }
};
var S = class {
  options;
  block;
  constructor(e) {
    this.options = e || R;
  }
  static passThroughHooks = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens", "emStrongMask"]);
  static passThroughHooksRespectAsync = /* @__PURE__ */ new Set(["preprocess", "postprocess", "processAllTokens"]);
  preprocess(e) {
    return e;
  }
  postprocess(e) {
    return e;
  }
  processAllTokens(e) {
    return e;
  }
  emStrongMask(e) {
    return e;
  }
  provideLexer(e = this.block) {
    return e ? x.lex : x.lexInline;
  }
  provideParser(e = this.block) {
    return e ? b.parse : b.parseInline;
  }
};
var Z = class {
  defaults = C();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = b;
  Renderer = P;
  TextRenderer = L;
  Lexer = x;
  Tokenizer = y;
  Hooks = S;
  constructor(...e) {
    this.use(...e);
  }
  walkTokens(e, t) {
    let n = [];
    for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
      case "table": {
        let r = s;
        for (let i of r.header) n = n.concat(this.walkTokens(i.tokens, t));
        for (let i of r.rows) for (let o of i) n = n.concat(this.walkTokens(o.tokens, t));
        break;
      }
      case "list": {
        let r = s;
        n = n.concat(this.walkTokens(r.items, t));
        break;
      }
      default: {
        let r = s;
        this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i) => {
          let o = r[i].flat(1 / 0);
          n = n.concat(this.walkTokens(o, t));
        }) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
      }
    }
    return n;
  }
  use(...e) {
    let t = this.defaults.extensions || { renderers: {}, childTokens: {} };
    return e.forEach((n) => {
      let s = { ...n };
      if (s.async = this.defaults.async || s.async || false, n.extensions && (n.extensions.forEach((r) => {
        if (!r.name) throw new Error("extension name required");
        if ("renderer" in r) {
          let i = t.renderers[r.name];
          i ? t.renderers[r.name] = function(...o) {
            let p = r.renderer.apply(this, o);
            return p === false && (p = i.apply(this, o)), p;
          } : t.renderers[r.name] = r.renderer;
        }
        if ("tokenizer" in r) {
          if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
          let i = t[r.level];
          i ? i.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
        }
        "childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
      }), s.extensions = t), n.renderer) {
        let r = this.defaults.renderer || new P(this.defaults);
        for (let i in n.renderer) {
          if (!(i in r)) throw new Error(`renderer '${i}' does not exist`);
          if (["options", "parser"].includes(i)) continue;
          let o = i, p = n.renderer[o], a = r[o];
          r[o] = (...u) => {
            let c = p.apply(r, u);
            return c === false && (c = a.apply(r, u)), c || "";
          };
        }
        s.renderer = r;
      }
      if (n.tokenizer) {
        let r = this.defaults.tokenizer || new y(this.defaults);
        for (let i in n.tokenizer) {
          if (!(i in r)) throw new Error(`tokenizer '${i}' does not exist`);
          if (["options", "rules", "lexer"].includes(i)) continue;
          let o = i, p = n.tokenizer[o], a = r[o];
          r[o] = (...u) => {
            let c = p.apply(r, u);
            return c === false && (c = a.apply(r, u)), c;
          };
        }
        s.tokenizer = r;
      }
      if (n.hooks) {
        let r = this.defaults.hooks || new S();
        for (let i in n.hooks) {
          if (!(i in r)) throw new Error(`hook '${i}' does not exist`);
          if (["options", "block"].includes(i)) continue;
          let o = i, p = n.hooks[o], a = r[o];
          S.passThroughHooks.has(i) ? r[o] = (u) => {
            if (this.defaults.async && S.passThroughHooksRespectAsync.has(i)) return (async () => {
              let h = await p.call(r, u);
              return a.call(r, h);
            })();
            let c = p.call(r, u);
            return a.call(r, c);
          } : r[o] = (...u) => {
            if (this.defaults.async) return (async () => {
              let h = await p.apply(r, u);
              return h === false && (h = await a.apply(r, u)), h;
            })();
            let c = p.apply(r, u);
            return c === false && (c = a.apply(r, u)), c;
          };
        }
        s.hooks = r;
      }
      if (n.walkTokens) {
        let r = this.defaults.walkTokens, i = n.walkTokens;
        s.walkTokens = function(o) {
          let p = [];
          return p.push(i.call(this, o)), r && (p = p.concat(r.call(this, o))), p;
        };
      }
      this.defaults = { ...this.defaults, ...s };
    }), this;
  }
  setOptions(e) {
    return this.defaults = { ...this.defaults, ...e }, this;
  }
  lexer(e, t) {
    return x.lex(e, t ?? this.defaults);
  }
  parser(e, t) {
    return b.parse(e, t ?? this.defaults);
  }
  parseMarkdown(e) {
    return (n, s) => {
      let r = { ...s }, i = { ...this.defaults, ...r }, o = this.onError(!!i.silent, !!i.async);
      if (this.defaults.async === true && r.async === false) return o(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      if (typeof n > "u" || n === null) return o(new Error("marked(): input parameter is undefined or null"));
      if (typeof n != "string") return o(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
      if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
        let p = i.hooks ? await i.hooks.preprocess(n) : n, u = await (i.hooks ? await i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(p, i), c = i.hooks ? await i.hooks.processAllTokens(u) : u;
        i.walkTokens && await Promise.all(this.walkTokens(c, i.walkTokens));
        let k = await (i.hooks ? await i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(c, i);
        return i.hooks ? await i.hooks.postprocess(k) : k;
      })().catch(o);
      try {
        i.hooks && (n = i.hooks.preprocess(n));
        let a = (i.hooks ? i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i);
        i.hooks && (a = i.hooks.processAllTokens(a)), i.walkTokens && this.walkTokens(a, i.walkTokens);
        let c = (i.hooks ? i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i);
        return i.hooks && (c = i.hooks.postprocess(c)), c;
      } catch (p) {
        return o(p);
      }
    };
  }
  onError(e, t) {
    return (n) => {
      if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
        let s = "<p>An error occurred:</p><pre>" + O(n.message + "", true) + "</pre>";
        return t ? Promise.resolve(s) : s;
      }
      if (t) return Promise.reject(n);
      throw n;
    };
  }
};
var E = new Z();
function f(l3, e) {
  return E.parse(l3, e);
}
f.options = f.setOptions = function(l3) {
  return E.setOptions(l3), f.defaults = E.defaults, j(f.defaults), f;
};
f.getDefaults = C;
f.defaults = R;
function kt(...l3) {
  return E.use(...l3), f.defaults = E.defaults, j(f.defaults), f;
}
f.use = kt;
f.walkTokens = function(l3, e) {
  return E.walkTokens(l3, e);
};
f.parseInline = E.parseInline;
f.Parser = b;
f.parser = b.parse;
f.Renderer = P;
f.TextRenderer = L;
f.Lexer = x;
f.lexer = x.lex;
f.Tokenizer = y;
f.Hooks = S;
f.parse = f;
var nn = f.options;
var rn = f.setOptions;
var sn = f.walkTokens;
var on = f.parseInline;
var ln = b.parse;
var pn = x.lex;

// src/web-markdown-preview.ts
f.use({
  gfm: true,
  breaks: false
});
var SAFE_LINK_PATTERN = /^(?:(?:https?|mailto|tel):|note:\/\/note_[a-f0-9]{32}$|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
var NOTE_LINK_PATTERN = /^note:\/\/(note_[a-f0-9]{32})$/;
function renderMarkdown(markdown) {
  const rendered = f.parse(markdown, { async: false });
  const sanitized = purify.sanitize(rendered, {
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option", "iframe", "object", "embed", "svg", "math", "video", "audio"],
    FORBID_ATTR: ["style"],
    RETURN_TRUSTED_TYPE: false,
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: SAFE_LINK_PATTERN
  });
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  for (const link of template.content.querySelectorAll("a")) {
    const note = NOTE_LINK_PATTERN.exec(link.getAttribute("href") ?? "");
    if (note?.[1]) {
      link.removeAttribute("href");
      link.dataset.noteId = note[1];
      link.classList.add("note-reference");
      continue;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  return template.innerHTML;
}

// src/knowledge-activity-notes.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function KnowledgeActivityNotes({ sessionId, projectId, controller }) {
  const initial = controller.selection(sessionId);
  const [folderId, setFolderId] = (0, import_react3.useState)(initial.noteFolderId ?? null);
  const [crumbs, setCrumbs] = (0, import_react3.useState)(initial.noteCrumbs ?? [{ id: null, name: "\u5168\u90E8\u7B14\u8BB0" }]);
  const [selectedId, setSelectedId] = (0, import_react3.useState)(initial.noteDocumentId);
  const [nodes, setNodes] = (0, import_react3.useState)([]);
  const [content, setContent] = (0, import_react3.useState)();
  const [queryInput, setQueryInput] = (0, import_react3.useState)("");
  const [query, setQuery] = (0, import_react3.useState)("");
  const [listState, setListState] = (0, import_react3.useState)("loading");
  const [contentState, setContentState] = (0, import_react3.useState)("idle");
  const [error, setError] = (0, import_react3.useState)("");
  const listRequest = (0, import_react3.useRef)(new LatestRequest());
  const [refresh, setRefresh] = (0, import_react3.useState)(0);
  const loadNodes = (0, import_react3.useCallback)(async () => {
    const signal = listRequest.current.start();
    setListState("loading");
    setError("");
    try {
      const value = await loadNoteIndex({
        sessionId,
        ...projectId === void 0 ? {} : { projectId },
        parentId: folderId,
        query,
        ...signal === void 0 ? {} : { signal }
      });
      if (signal.aborted) return;
      setNodes(value);
      setListState("ready");
    } catch (reason) {
      if (signal?.aborted) return;
      setListState("error");
      setError(message(reason));
    }
  }, [folderId, projectId, query, sessionId]);
  (0, import_react3.useEffect)(() => {
    void loadNodes();
    return () => {
      listRequest.current.cancel();
    };
  }, [loadNodes, refresh]);
  (0, import_react3.useEffect)(() => {
    if (selectedId === void 0) {
      setContent(void 0);
      setContentState("idle");
      return;
    }
    const abort = new AbortController();
    setContentState("loading");
    setError("");
    void loadNoteContent({
      id: selectedId,
      sessionId,
      ...projectId === void 0 ? {} : { projectId },
      signal: abort.signal
    }).then((value) => {
      if (abort.signal.aborted) return;
      setContent(value);
      setContentState("ready");
    }).catch((reason) => {
      if (abort.signal.aborted) return;
      setContentState("error");
      setError(message(reason));
    });
    return () => {
      abort.abort();
    };
  }, [projectId, refresh, selectedId, sessionId]);
  const openFolder = (node) => {
    setFolderId(node.id);
    const nextCrumbs = [...crumbs, { id: node.id, name: node.name }];
    setCrumbs(nextCrumbs);
    setQuery("");
    setQueryInput("");
    controller.select(sessionId, { mode: "notes", noteFolderId: node.id, noteDocumentId: void 0, noteCrumbs: nextCrumbs });
  };
  const openCrumb = (crumb, index) => {
    setFolderId(crumb.id);
    const nextCrumbs = crumbs.slice(0, index + 1);
    setCrumbs(nextCrumbs);
    setSelectedId(void 0);
    controller.select(sessionId, { mode: "notes", noteFolderId: crumb.id, noteDocumentId: void 0, noteCrumbs: nextCrumbs });
  };
  const openNode = (node) => {
    if (node.kind === "folder") return openFolder(node);
    if (!node.editable) return;
    setSelectedId(node.id);
    controller.select(sessionId, { ...controller.selection(sessionId), mode: "notes", noteFolderId: folderId, noteDocumentId: node.id });
  };
  const closeDocument = () => {
    setSelectedId(void 0);
    setContent(void 0);
    controller.select(sessionId, { ...controller.selection(sessionId), mode: "notes", noteFolderId: folderId, noteDocumentId: void 0 });
  };
  const submitSearch = (event) => {
    event.preventDefault();
    setSelectedId(void 0);
    setContent(void 0);
    controller.select(sessionId, { noteDocumentId: void 0 });
    setQuery(queryInput.trim());
  };
  if (selectedId !== void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    NoteReader,
    {
      value: content,
      state: contentState,
      error,
      onBack: closeDocument,
      onRetry: () => setRefresh((value) => value + 1)
    }
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-browser", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "dsh-knowledge-activity-search", role: "search", onSubmit: submitSearch, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconSearchOutline16, { size: 16, "aria-hidden": "true" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u641C\u7D22\u7B14\u8BB0\u6587\u6863", value: queryInput, placeholder: "\u641C\u7D22\u7B14\u8BB0\u548C\u76EE\u5F55\u2026", onChange: (event) => setQueryInput(event.target.value) }),
      queryInput && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
        setQueryInput("");
        setQuery("");
      }, "aria-label": "\u6E05\u9664\u641C\u7D22", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 }) })
    ] }),
    !query && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { className: "dsh-knowledge-activity-breadcrumbs", "aria-label": "\u7B14\u8BB0\u76EE\u5F55\u8DEF\u5F84", children: crumbs.map((crumb, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
      index > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronRightOutline14, { size: 12 }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "aria-current": index === crumbs.length - 1 ? "location" : void 0, onClick: () => openCrumb(crumb, index), children: crumb.name })
    ] }, `${crumb.id ?? "root"}-${index}`)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-list-heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: query ? `\u201C${query}\u201D \u7684\u7ED3\u679C` : crumbs.at(-1)?.name ?? "\u7B14\u8BB0\u6587\u6863" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: query ? "\u641C\u7D22\u5168\u90E8\u7B14\u8BB0" : `\u5F53\u524D\u663E\u793A ${nodes.length} \u9879` })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5237\u65B0\u7B14\u8BB0", title: "\u5237\u65B0", onClick: () => setRefresh((value) => value + 1), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconRefreshOutline14, { size: 14 }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-knowledge-activity-list", "aria-busy": listState === "loading", children: listState === "loading" && nodes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityState, { label: "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\u2026" }) : listState === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityError, { error, onRetry: () => setRefresh((value) => value + 1) }) : nodes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityEmpty, { query }) : nodes.map((node) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dsh-knowledge-activity-row", disabled: node.kind !== "folder" && !node.editable, onClick: () => openNode(node), children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-knowledge-activity-row-icon", children: node.kind === "folder" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconFolderOpenOutline16, { size: 16 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconDataOutline16, { size: 16 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-knowledge-activity-row-copy", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: node.name }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: node.kind === "folder" ? "\u76EE\u5F55" : node.editable ? formatSize(node.size) : "\u6682\u4E0D\u652F\u6301\u4FA7\u680F\u9884\u89C8" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-knowledge-activity-row-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { dateTime: node.updatedAt, children: formatDate(node.updatedAt) }),
        node.kind === "folder" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronRightOutline14, { size: 13 })
      ] })
    ] }, node.id)) })
  ] });
}
function NoteReader({ value, state, error, onBack, onRetry }) {
  const html2 = (0, import_react3.useMemo)(() => value === void 0 ? "" : renderMarkdown(value.content), [value]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-reader", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-reader-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dsh-knowledge-activity-back", onClick: onBack, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconChevronLeftOutline14, { size: 14 }),
        "\u7B14\u8BB0\u76EE\u5F55"
      ] }),
      value && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
        formatDate(value.node.updatedAt),
        " \u66F4\u65B0"
      ] })
    ] }),
    state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityState, { label: "\u6B63\u5728\u6253\u5F00\u7B14\u8BB0\u2026" }) : state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityError, { error, onRetry }) : value === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityState, { label: "\u6B63\u5728\u51C6\u5907\u7B14\u8BB0\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-document-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-knowledge-activity-document-icon", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconDataOutline16, { size: 18 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: value.node.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
            "\u7B14\u8BB0\u6587\u6863 \xB7 ",
            formatSize(value.node.size)
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("article", { className: "dsh-knowledge-activity-markdown", dangerouslySetInnerHTML: { __html: html2 } })
    ] })
  ] });
}
function ActivityState({ label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-knowledge-activity-state", role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true" }),
    label
  ] });
}
function ActivityError({ error, onRetry }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-error", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onRetry, children: "\u91CD\u8BD5" })
  ] });
}
function ActivityEmpty({ query }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-knowledge-activity-empty", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconDataOutline16, { size: 20 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: query ? "\u6CA1\u6709\u627E\u5230\u76F8\u5173\u7B14\u8BB0" : "\u8FD9\u4E2A\u76EE\u5F55\u8FD8\u662F\u7A7A\u7684" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: query ? "\u6362\u4E2A\u5173\u952E\u8BCD\uFF0C\u6216\u6E05\u9664\u641C\u7D22\u540E\u6D4F\u89C8\u76EE\u5F55\u3002" : "\u53EF\u4EE5\u5728\u5B8C\u6574\u5DE5\u4F5C\u533A\u4E2D\u65B0\u5EFA\u6216\u5BFC\u5165\u7B14\u8BB0\u3002" })
  ] });
}
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u672A\u77E5\u65F6\u95F4";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}
function formatSize(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function message(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}

// src/knowledge-activity-panel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function KnowledgeActivityPanel(props) {
  const sessionId = String(props.sessionId);
  const projectId = props.useSessions((state) => state.byId[props.sessionId]?.cwd);
  const initial = props.controller.selection(sessionId);
  const [mode, setMode] = (0, import_react4.useState)(initial.mode ?? "knowledge");
  const [mounts, setMounts] = (0, import_react4.useState)([]);
  const [selectedBaseId, setSelectedBaseId] = (0, import_react4.useState)(initial.knowledgeBaseId);
  const [selectedDocumentId, setSelectedDocumentId] = (0, import_react4.useState)(initial.documentId);
  const [documents, setDocuments] = (0, import_react4.useState)([]);
  const [documentValue, setDocumentValue] = (0, import_react4.useState)();
  const [queryInput, setQueryInput] = (0, import_react4.useState)("");
  const [query, setQuery] = (0, import_react4.useState)("");
  const [mountState, setMountState] = (0, import_react4.useState)("loading");
  const [listState, setListState] = (0, import_react4.useState)("idle");
  const [documentState, setDocumentState] = (0, import_react4.useState)("idle");
  const [documentRefresh, setDocumentRefresh] = (0, import_react4.useState)(0);
  const [error, setError] = (0, import_react4.useState)("");
  const [nextCursor, setNextCursor] = (0, import_react4.useState)();
  const [baseMenuOpen, setBaseMenuOpen] = (0, import_react4.useState)(false);
  const indexRequest = (0, import_react4.useRef)(new LatestRequest());
  const mountRequest = (0, import_react4.useRef)(new LatestRequest());
  const scopeRef = (0, import_react4.useRef)(null);
  (0, import_react4.useEffect)(() => {
    if (!baseMenuOpen) return;
    const closeOutside = (event) => {
      if (!scopeRef.current?.contains(event.target)) setBaseMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setBaseMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [baseMenuOpen]);
  const refreshMounts = (0, import_react4.useCallback)(async () => {
    const signal = mountRequest.current.start();
    setMountState("loading");
    setError("");
    try {
      const next = await loadMountedKnowledge(sessionId, projectId, signal);
      if (signal.aborted) return;
      setMounts(next);
      const current = props.controller.selection(sessionId);
      const selected = next.some((item) => item.knowledgeBaseId === current.knowledgeBaseId) ? current.knowledgeBaseId : next[0]?.knowledgeBaseId;
      props.controller.select(sessionId, {
        knowledgeBaseId: selected,
        documentId: selected === current.knowledgeBaseId ? current.documentId : void 0
      });
      setSelectedBaseId(selected);
      if (selected !== current.knowledgeBaseId) {
        setSelectedDocumentId(void 0);
        setDocumentValue(void 0);
      }
      setMountState("ready");
    } catch (reason) {
      if (signal?.aborted) return;
      setMountState("error");
      setError(message2(reason));
    }
  }, [projectId, props.controller, sessionId]);
  (0, import_react4.useEffect)(() => {
    void refreshMounts();
    return () => {
      mountRequest.current.cancel();
    };
  }, [refreshMounts]);
  const loadIndex = (0, import_react4.useCallback)(async (cursor, append = false) => {
    const signal = indexRequest.current.start();
    if (mounts.length === 0 || query.length === 0 && selectedBaseId === void 0) {
      setDocuments([]);
      setNextCursor(void 0);
      setListState("ready");
      return;
    }
    setListState("loading");
    setError("");
    try {
      const result = await loadKnowledgeDocumentIndex({
        sessionId,
        ...projectId === void 0 ? {} : { projectId },
        knowledgeBaseIds: query ? mounts.map((item) => item.knowledgeBaseId) : [selectedBaseId],
        ...query ? { query } : {},
        ...cursor === void 0 ? {} : { cursor },
        ...signal === void 0 ? {} : { signal }
      });
      if (signal.aborted) return;
      setDocuments((current) => append ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
      setListState("ready");
    } catch (reason) {
      if (signal?.aborted) return;
      setListState("error");
      setError(message2(reason));
    }
  }, [mounts, projectId, query, selectedBaseId, sessionId]);
  (0, import_react4.useEffect)(() => {
    void loadIndex();
    return () => {
      indexRequest.current.cancel();
    };
  }, [loadIndex]);
  (0, import_react4.useEffect)(() => {
    if (selectedDocumentId === void 0) {
      setDocumentValue(void 0);
      setDocumentState("idle");
      return;
    }
    const controller = new AbortController();
    setDocumentState("loading");
    setError("");
    void loadKnowledgeDocument({
      id: selectedDocumentId,
      sessionId,
      ...projectId === void 0 ? {} : { projectId },
      signal: controller.signal
    }).then((value) => {
      if (controller.signal.aborted) return;
      setDocumentValue(value);
      setDocumentState("ready");
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      setDocumentState("error");
      setError(message2(reason));
    });
    return () => {
      controller.abort();
    };
  }, [documentRefresh, projectId, selectedDocumentId, sessionId]);
  const selectBase = (knowledgeBaseId) => {
    setBaseMenuOpen(false);
    setSelectedBaseId(knowledgeBaseId);
    setSelectedDocumentId(void 0);
    setDocumentValue(void 0);
    setQueryInput("");
    setQuery("");
    props.controller.select(sessionId, { mode: "knowledge", knowledgeBaseId, documentId: void 0 });
  };
  const selectDocument = (document2) => {
    setSelectedBaseId(document2.knowledgeBaseId);
    setSelectedDocumentId(document2.id);
    props.controller.select(sessionId, {
      mode: "knowledge",
      knowledgeBaseId: document2.knowledgeBaseId,
      documentId: document2.id
    });
  };
  const closeDocument = () => {
    setSelectedDocumentId(void 0);
    setDocumentValue(void 0);
    props.controller.select(sessionId, {
      mode: "knowledge",
      documentId: void 0,
      ...selectedBaseId === void 0 ? {} : { knowledgeBaseId: selectedBaseId }
    });
  };
  const submitSearch = (event) => {
    event.preventDefault();
    setSelectedDocumentId(void 0);
    setDocumentValue(void 0);
    props.controller.select(sessionId, { documentId: void 0 });
    setQuery(queryInput.trim());
  };
  const clearSearch = () => {
    setQueryInput("");
    setQuery("");
  };
  const openWorkspace = () => {
    const noteId = props.controller.selection(sessionId).noteDocumentId;
    props.controller.openWorkspace(mode === "notes" ? { view: "notes", ...noteId === void 0 ? {} : { noteId } } : documentValue === void 0 ? void 0 : {
      knowledgeBaseId: documentValue.knowledgeBaseId,
      documentId: documentValue.id
    });
  };
  const selectMode = (nextMode) => {
    setMode(nextMode);
    setBaseMenuOpen(false);
    props.controller.select(sessionId, { ...props.controller.selection(sessionId), mode: nextMode });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dsh-knowledge-activity-panel", "data-knowledge-surface": "activity", "aria-label": "\u4F1A\u8BDD\u77E5\u8BC6\u5E93", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "dsh-knowledge-activity-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-title", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-knowledge-activity-mark", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDatabaseOutline16, { size: 17 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "\u77E5\u8BC6\u5E93" }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("small", { children: [
            "\u5F53\u524D\u4F1A\u8BDD \xB7 ",
            shortId(sessionId)
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-header-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5728\u5B8C\u6574\u5DE5\u4F5C\u533A\u4E2D\u6253\u5F00", title: "\u5B8C\u6574\u5DE5\u4F5C\u533A", onClick: openWorkspace, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconFullscreenOutline16, { size: 16 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5173\u95ED\u4F1A\u8BDD\u77E5\u8BC6\u5E93", title: "\u5173\u95ED", onClick: () => props.controller.close(sessionId), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconCloseOutline16, { size: 16 }) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("nav", { className: "dsh-knowledge-activity-tabs", "aria-label": "\u77E5\u8BC6\u5E93\u5185\u5BB9\u7C7B\u578B", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: mode === "knowledge" ? "is-active" : "", "aria-pressed": mode === "knowledge", onClick: () => selectMode("knowledge"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDatabaseOutline16, { size: 15 }),
        "\u77E5\u8BC6\u6587\u6863"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: mode === "notes" ? "is-active" : "", "aria-pressed": mode === "notes", onClick: () => selectMode("notes"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDataOutline16, { size: 15 }),
        "\u7B14\u8BB0\u6587\u6863"
      ] })
    ] }),
    mode === "notes" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(KnowledgeActivityNotes, { sessionId, projectId, controller: props.controller }) : selectedDocumentId === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-browser", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { className: "dsh-knowledge-activity-search", role: "search", onSubmit: submitSearch, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconSearchOutline16, { size: 16, "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { "aria-label": "\u641C\u7D22\u5F53\u524D\u4F1A\u8BDD\u77E5\u8BC6\u6587\u6863", value: queryInput, placeholder: "\u641C\u7D22\u5DF2\u6302\u8F7D\u77E5\u8BC6\u2026", onChange: (event) => setQueryInput(event.target.value) }),
        queryInput && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: clearSearch, "aria-label": "\u6E05\u9664\u641C\u7D22", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconCloseOutline16, { size: 14 }) })
      ] }),
      mountState === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityState2, { label: "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD\u6302\u8F7D\u2026" }) : mountState === "error" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityError2, { message: error, onRetry: () => {
        void refreshMounts();
      } }) : mounts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityEmpty2, { title: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u6302\u8F7D\u77E5\u8BC6\u5E93", description: "\u5728\u5B8C\u6574\u5DE5\u4F5C\u533A\u4E2D\u6302\u8F7D\u540E\uFF0C\u5C31\u80FD\u5728\u8FD9\u91CC\u968F\u624B\u67E5\u9605\u6587\u6863\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { ref: scopeRef, className: "dsh-knowledge-activity-scope", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "dsh-knowledge-activity-scope-trigger", "aria-haspopup": "listbox", "aria-expanded": baseMenuOpen, onClick: () => setBaseMenuOpen((value) => !value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-knowledge-activity-scope-icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDatabaseOutline16, { size: 15 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: "\u5F53\u524D\u77E5\u8BC6\u5E93" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: mounts.find((item) => item.knowledgeBaseId === selectedBaseId)?.base.name })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconChevronDownOutline14, { size: 14, className: baseMenuOpen ? "is-open" : "" })
          ] }),
          baseMenuOpen && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-knowledge-activity-scope-menu", role: "listbox", "aria-label": "\u5207\u6362\u77E5\u8BC6\u5E93", children: mounts.map((mount) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "button",
            {
              type: "button",
              role: "option",
              "aria-selected": selectedBaseId === mount.knowledgeBaseId,
              className: selectedBaseId === mount.knowledgeBaseId ? "is-active" : "",
              onClick: () => selectBase(mount.knowledgeBaseId),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDataOutline16, { size: 15 }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: mount.base.name }),
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: mount.inheritedFrom === "project" ? "\u9879\u76EE\u6302\u8F7D" : "\u4F1A\u8BDD\u6302\u8F7D" })
                ] })
              ]
            },
            mount.knowledgeBaseId
          )) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-list-heading", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: query ? `\u201C${query}\u201D \u7684\u7ED3\u679C` : "\u77E5\u8BC6\u6587\u6863" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: query ? "\u641C\u7D22\u5168\u90E8\u5DF2\u6302\u8F7D\u77E5\u8BC6\u5E93" : `\u5F53\u524D\u663E\u793A ${documents.length} \u9879` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5237\u65B0\u6587\u6863", title: "\u5237\u65B0", onClick: () => {
            void loadIndex();
          }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutline14, { size: 14 }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-knowledge-activity-list", "aria-busy": listState === "loading", children: listState === "loading" && documents.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityState2, { label: "\u6B63\u5728\u8BFB\u53D6\u6587\u6863\u2026" }) : listState === "error" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityError2, { message: error, onRetry: () => {
          void loadIndex();
        } }) : documents.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityEmpty2, { title: query ? "\u6CA1\u6709\u627E\u5230\u76F8\u5173\u6587\u6863" : "\u8FD9\u91CC\u8FD8\u6CA1\u6709\u77E5\u8BC6\u6587\u6863", description: query ? "\u6362\u4E2A\u5173\u952E\u8BCD\uFF0C\u6216\u6E05\u9664\u641C\u7D22\u540E\u6D4F\u89C8\u76EE\u5F55\u3002" : "\u5BA1\u6838\u901A\u8FC7\u6216\u76F4\u63A5\u56DE\u5199\u7684\u77E5\u8BC6\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          documents.map((document2) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            DocumentRow,
            {
              document: document2,
              baseName: query ? mounts.find((item) => item.knowledgeBaseId === document2.knowledgeBaseId)?.base.name : void 0,
              onClick: () => selectDocument(document2)
            },
            document2.id
          )),
          nextCursor && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "dsh-knowledge-activity-load-more", disabled: listState === "loading", onClick: () => {
            void loadIndex(nextCursor, true);
          }, children: listState === "loading" ? "\u6B63\u5728\u52A0\u8F7D\u2026" : "\u52A0\u8F7D\u66F4\u591A" })
        ] }) })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      DocumentReader,
      {
        value: documentValue,
        state: documentState,
        error,
        onBack: closeDocument,
        onRetry: () => setDocumentRefresh((value) => value + 1)
      }
    )
  ] });
}
function DocumentRow({ document: document2, baseName, onClick }) {
  const stateLabel = document2.documentState === "resolved" ? "\u5DF2\u89E3\u51B3" : document2.documentState === "complete" ? "\u5DF2\u5B8C\u6210" : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "dsh-knowledge-activity-row", onClick, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-knowledge-activity-row-icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDataOutline16, { size: 16 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-knowledge-activity-row-copy", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: document2.title }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("small", { children: baseName ? `${baseName} \xB7 ${document2.relPath}` : document2.relPath })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-knowledge-activity-row-meta", children: [
      stateLabel && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("em", { children: stateLabel }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("time", { dateTime: document2.updatedAt, children: formatDate2(document2.updatedAt) })
    ] })
  ] });
}
function DocumentReader({ value, state, error, onBack, onRetry }) {
  const html2 = (0, import_react4.useMemo)(() => value === void 0 ? "" : renderMarkdown(readableMarkdown(value.content)), [value]);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-reader", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-reader-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", className: "dsh-knowledge-activity-back", onClick: onBack, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconChevronLeftOutline14, { size: 14 }),
        "\u6587\u6863\u76EE\u5F55"
      ] }),
      value && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
        formatDate2(value.updatedAt),
        " \u66F4\u65B0"
      ] })
    ] }),
    state === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityState2, { label: "\u6B63\u5728\u6253\u5F00\u6587\u6863\u2026" }) : state === "error" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityError2, { message: error, onRetry }) : value === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ActivityState2, { label: "\u6B63\u5728\u51C6\u5907\u6587\u6863\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-document-heading", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-knowledge-activity-document-icon", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDataOutline16, { size: 18 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: value.title }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: value.relPath })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("article", { className: "dsh-knowledge-activity-markdown", dangerouslySetInnerHTML: { __html: html2 } })
    ] })
  ] });
}
function ActivityState2({ label }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "dsh-knowledge-activity-state", role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { "aria-hidden": "true" }),
    label
  ] });
}
function ActivityError2({ message: message3, onRetry }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-error", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: message3 }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: onRetry, children: "\u91CD\u8BD5" })
  ] });
}
function ActivityEmpty2({ title, description }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-knowledge-activity-empty", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDatabaseOutline16, { size: 20 }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: title }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: description })
  ] });
}
function readableMarkdown(value) {
  return value.replace(/^---\s*\n[\s\S]*?\n---\s*\n*/u, "").replace(/^#\s+[^\n]+\n*/u, "");
}
function shortId(value) {
  return value.length <= 12 ? value : `${value.slice(0, 7)}\u2026${value.slice(-5)}`;
}
function formatDate2(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "\u672A\u77E5\u65F6\u95F4";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}
function message2(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}

// src/knowledge-activity-presentation.tsx
var import_react5 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function KnowledgeActivityPresentation({ controller, sessionId, onClosed, children }) {
  const root = (0, import_react5.useRef)(null);
  const open = (0, import_react5.useSyncExternalStore)(controller.subscribe, () => controller.isOpen(sessionId));
  (0, import_react5.useLayoutEffect)(() => {
    const viewport = root.current;
    const panel = viewport?.firstElementChild;
    if (!viewport || !panel) return;
    let cancelled = false;
    let timeout;
    let reveal;
    const width = panel.getBoundingClientRect().width;
    panel.style.width = `${width > 1 ? width : 360}px`;
    viewport.toggleAttribute("inert", !open);
    const settle = () => {
      if (cancelled) return;
      cancelled = true;
      if (timeout !== void 0) clearTimeout(timeout);
      reveal?.cancel();
      panel.style.removeProperty("width");
      if (!open) onClosed();
    };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!open && reducedMotion) {
      settle();
      return;
    }
    const frame = requestAnimationFrame(() => {
      const transitions = [];
      for (let parent = viewport.parentElement; parent; parent = parent.parentElement) {
        for (const animation of parent.getAnimations()) {
          if ("transitionProperty" in animation && animation.transitionProperty === "grid-template-columns") transitions.push(animation);
        }
        if (transitions.length > 0) break;
      }
      if (open && transitions.length > 0) {
        for (const transition of transitions) transition.finish();
        panel.style.removeProperty("width");
        if (!reducedMotion) {
          reveal = panel.animate([
            { transform: "translateX(100%)" },
            { transform: "translateX(0)" }
          ], { duration: 180, easing: "cubic-bezier(.22, 1, .36, 1)" });
        }
      }
      timeout = setTimeout(settle, 1e3);
      void Promise.allSettled((reveal ? [reveal] : transitions).map((animation) => animation.finished)).then(settle);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (timeout !== void 0) clearTimeout(timeout);
      reveal?.cancel();
      panel.style.removeProperty("width");
    };
  }, [open, onClosed]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref: root, className: "dsh-knowledge-activity-viewport", "aria-hidden": !open || void 0, children });
}

// src/knowledge-activity-controller.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function createKnowledgeActivityController(ctx, options) {
  if (supportsDockedPanels(ctx)) return createDockedKnowledgeController(ctx, options);
  const runtime = ctx;
  const listeners = /* @__PURE__ */ new Set();
  const states = /* @__PURE__ */ new Map();
  let currentSessionId = normalizeSessionId(runtime.sessions.list.getSnapshot().current);
  let mountedSessionId;
  let restoreFrame;
  let disposePanel;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const cancelRestore = () => {
    if (restoreFrame === void 0) return;
    window.cancelAnimationFrame(restoreFrame);
    restoreFrame = void 0;
  };
  const unmount = () => {
    if (disposePanel === void 0) return false;
    const dispose = disposePanel;
    disposePanel = void 0;
    mountedSessionId = void 0;
    dispose();
    return true;
  };
  const mount = (sessionId, openDetails = true) => {
    if (mountedSessionId === sessionId && disposePanel !== void 0) {
      if (openDetails) ctx.layout.openDetails();
      return;
    }
    unmount();
    mountedSessionId = sessionId;
    const onClosed = () => {
      if (mountedSessionId === sessionId && states.get(sessionId)?.open !== true) unmount();
    };
    disposePanel = ctx.slots.register({ name: "details", priority: -3 }, (props) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(KnowledgeActivityPresentation, { sessionId, controller, onClosed, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(KnowledgeActivityPanel, { ...props, controller }) }, sessionId));
    if (openDetails) ctx.layout.openDetails();
  };
  const syncCurrentSession = () => {
    const nextSessionId = normalizeSessionId(runtime.sessions.list.getSnapshot().current);
    if (nextSessionId === currentSessionId) return;
    cancelRestore();
    const wasMounted = unmount();
    currentSessionId = nextSessionId;
    if (nextSessionId !== void 0 && states.get(nextSessionId)?.open === true) {
      mount(nextSessionId, false);
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = void 0;
        if (currentSessionId === nextSessionId && mountedSessionId === nextSessionId && states.get(nextSessionId)?.open === true) {
          ctx.layout.openDetails();
        }
      });
    } else if (wasMounted) {
      ctx.layout.closeDetails();
    }
    notify();
  };
  const controller = {
    open(sessionId, selection) {
      const previous = states.get(sessionId);
      states.set(sessionId, { ...mergeActivitySelection(previous ?? {}, selection ?? {}), open: true });
      options.beforeOpen();
      if (sessionId === currentSessionId) {
        cancelRestore();
        mount(sessionId);
      }
      notify();
    },
    toggle(sessionId) {
      if (states.get(sessionId)?.open === true) controller.close(sessionId);
      else controller.open(sessionId);
    },
    close(sessionId, immediate = false) {
      const target = sessionId ?? currentSessionId;
      if (target === void 0) return;
      const previous = states.get(target) ?? { open: false };
      states.set(target, { ...previous, open: false });
      if (target === currentSessionId) {
        cancelRestore();
        if (mountedSessionId === target) ctx.layout.closeDetails();
        if (immediate) unmount();
      }
      notify();
    },
    isOpen: (sessionId) => states.get(sessionId)?.open === true,
    selection(sessionId) {
      const state = states.get(sessionId);
      return {
        ...state?.mode === void 0 ? {} : { mode: state.mode },
        ...state?.knowledgeBaseId === void 0 ? {} : { knowledgeBaseId: state.knowledgeBaseId },
        ...state?.documentId === void 0 ? {} : { documentId: state.documentId },
        ...state?.noteFolderId === void 0 ? {} : { noteFolderId: state.noteFolderId },
        ...state?.noteDocumentId === void 0 ? {} : { noteDocumentId: state.noteDocumentId },
        ...state?.noteCrumbs === void 0 ? {} : { noteCrumbs: state.noteCrumbs }
      };
    },
    select(sessionId, selection) {
      const previous = states.get(sessionId) ?? { open: true };
      states.set(sessionId, { ...mergeActivitySelection(previous, selection), open: previous.open });
      notify();
    },
    openWorkspace(target) {
      controller.close(void 0, true);
      options.openWorkspace(target);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposeSelection();
      cancelRestore();
      unmount();
      states.clear();
      listeners.clear();
    }
  };
  const disposeSelection = runtime.sessions.list.subscribe(syncCurrentSession);
  return controller;
}
function normalizeSessionId(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function createDockedKnowledgeController(ctx, options) {
  const selections = /* @__PURE__ */ new Map();
  const listeners = /* @__PURE__ */ new Set();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const current = () => normalizeSessionId(ctx.sessions.list.getSnapshot().current);
  const panel = createDockedPanel(
    ctx,
    "@zhongruan/dsh-knowledge/activity",
    "\u77E5\u8BC6\u5E93",
    (props) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(KnowledgeActivityPanel, { ...props, controller }),
    notify
  );
  const controller = {
    open(sessionId, selection) {
      if (selection !== void 0) controller.select(sessionId, selection);
      options.beforeOpen();
      panel.open(sessionId);
    },
    toggle(sessionId) {
      if (panel.isOpen(sessionId)) controller.close(sessionId);
      else controller.open(sessionId);
    },
    close(sessionId) {
      const target = sessionId ?? current();
      if (target !== void 0) panel.close(target);
    },
    isOpen: panel.isOpen,
    selection: (sessionId) => selections.get(sessionId) ?? {},
    select(sessionId, selection) {
      selections.set(sessionId, mergeActivitySelection(selections.get(sessionId) ?? {}, selection));
      notify();
    },
    openWorkspace(target) {
      controller.close();
      options.openWorkspace(target);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      panel.dispose();
      selections.clear();
      listeners.clear();
    }
  };
  return controller;
}

// src/constants.ts
var KNOWLEDGE_SETTINGS_NAMESPACE = "dsh-knowledge-connection";

// src/theme-bridge.ts
var KNOWLEDGE_THEME_MESSAGE = "@zhongruan/dsh-knowledge/host-theme";
var KNOWLEDGE_THEME_READY_MESSAGE = "@zhongruan/dsh-knowledge/host-theme-ready";
var KNOWLEDGE_THEME_PROTOCOL_VERSION = 1;
function createKnowledgeHostTheme(snapshot) {
  return {
    type: KNOWLEDGE_THEME_MESSAGE,
    version: KNOWLEDGE_THEME_PROTOCOL_VERSION,
    colorScheme: snapshot.active.colorScheme,
    tokens: { ...KNOWLEDGE_PALETTE[snapshot.active.colorScheme] }
  };
}

// src/client.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var PLUGIN_ID = "@zhongruan/dsh-knowledge";
var STYLE_ID = `${PLUGIN_ID}/client`;
var CONNECTION_CONTROL_PATH = "/knowledge-control/v1/connection";
var cachedConnectionView;
var inject = ["slots", "theme", "layout", "sessions"];
function apply2(ctx) {
  ctx.effect(installStyles, "dsh-knowledge: client styles");
  const docked = supportsDockedPanels(ctx);
  let activity;
  const workspace = createKnowledgeWorkspaceController(ctx, () => {
    if (!docked) activity?.close(void 0, true);
  });
  activity = createKnowledgeActivityController(ctx, {
    beforeOpen: () => {
      workspace.close();
      if (!docked) activatePluginWorkspace(PLUGIN_ID);
    },
    openWorkspace: (target) => {
      if (target === void 0) workspace.open();
      else workspace.openDocument(target);
    }
  });
  ctx.effect(() => observePluginWorkspace(PLUGIN_ID, () => {
    workspace.close();
    if (!docked) activity?.close(void 0, true);
  }), "dsh-knowledge: exclusive workspace");
  ctx.effect(() => () => {
    workspace.close();
    activity?.dispose();
  }, "dsh-knowledge: workspace lifecycle");
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "knowledge",
    order: -10
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(KnowledgeLauncher, { ...props, workspace, activity, docked: supportsDockedPanels(ctx) })));
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: KNOWLEDGE_SETTINGS_NAMESPACE
  }, KnowledgeConnectionCard));
  ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
    name: "conversation.chat.turnTail",
    select: (owner) => ({ turn: owner.turn.turn })
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(KnowledgeWritebackStatus, { sessionId: String(props.sessionId), turn: props.matched.turn, workspace })));
}
function KnowledgeWritebackStatus({
  sessionId,
  turn,
  workspace
}) {
  const [state, setState] = (0, import_react6.useState)();
  const [retrying, setRetrying] = (0, import_react6.useState)(false);
  const [readError, setReadError] = (0, import_react6.useState)();
  const client = (0, import_react6.useRef)();
  const container = (0, import_react6.useRef)(null);
  (0, import_react6.useEffect)(() => {
    setState(void 0);
    setRetrying(false);
    setReadError(void 0);
    const status = new WritebackStatusClient(
      `/knowledge-control/v1/writeback-status?sessionId=${encodeURIComponent(sessionId)}&turn=${turn}`,
      (value, pending, error) => {
        setState(value);
        setRetrying(pending);
        setReadError(error);
      }
    );
    client.current = status;
    const unsubscribeChanges = subscribeWritebackChanges("conversation-web", () => status.invalidate());
    let inView = true;
    const refresh = () => status.setVisible(inView && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? void 0 : new IntersectionObserver((entries2) => {
      inView = entries2[0]?.isIntersecting ?? true;
      refresh();
    }, { rootMargin: "100px" });
    if (container.current) observer?.observe(container.current);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    refresh();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      status.dispose();
      unsubscribeChanges();
      client.current = void 0;
    };
  }, [sessionId, turn]);
  if (state === void 0) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { ref: container, children: readError && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-knowledge-writeback-notice", role: "status", children: [
    readError,
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", onClick: () => workspace.openDocument({ view: "writeback", sessionId }), children: "\u7BA1\u7406\u56DE\u5199" })
  ] }) });
  const retry = () => client.current?.retry();
  const destinations = state.destinations ?? [];
  const summary = state.summary.replace(/^知识库回写\s*·\s*/u, "");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { ref: container, className: "dsh-knowledge-writeback-notice", "data-status": state.status, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-knowledge-writeback-summary", role: "status", "aria-atomic": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u77E5\u8BC6\u5E93\u56DE\u5199" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "@zhongruan/dsh-knowledge" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { title: state.error, children: summary }),
      state.status === "failed" && state.retryable && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", disabled: retrying, onClick: () => {
        void retry();
      }, children: retrying ? "\u91CD\u8BD5\u4E2D\u2026" : "\u91CD\u8BD5" }),
      state.status !== "completed" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", onClick: () => workspace.openDocument({ view: "writeback", sessionId }), children: "\u7BA1\u7406\u56DE\u5199" })
    ] }),
    destinations.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("ul", { className: "dsh-knowledge-writeback-destinations", "aria-label": "\u56DE\u5199\u76EE\u6807", children: destinations.map((destination, index) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dsh-knowledge-writeback-base", children: destination.knowledgeBaseName }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dsh-knowledge-writeback-separator", "aria-hidden": "true", children: "/" }),
      destination.documentId ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "button",
        {
          type: "button",
          className: "dsh-knowledge-writeback-document",
          title: `\u6253\u5F00 ${destination.documentPath ?? destination.documentTitle}`,
          "aria-label": `\u5728\u77E5\u8BC6\u5E93\u4E2D\u6253\u5F00 ${destination.documentTitle}`,
          onClick: () => {
            workspace.openDocument({ knowledgeBaseId: destination.knowledgeBaseId, documentId: destination.documentId });
          },
          children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: destination.documentPath ?? destination.documentTitle })
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { title: destination.documentTitle, children: `\u62DF\u65B0\u5EFA\uFF1A${destination.documentTitle}` }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { "data-disposition": destination.disposition, children: destination.disposition === "written" ? destination.documentState === "resolved" ? "\u5DF2\u89E3\u51B3" : destination.documentState === "complete" ? "\u5DF2\u5B8C\u6210" : "\u5DF2\u5199\u5165" : destination.documentState ? "\u5F85\u5BA1\u6838 \xB7 \u6807\u8BB0" + (destination.documentState === "resolved" ? "\u89E3\u51B3" : "\u5B8C\u6210") : "\u5F85\u5BA1\u6838" })
    ] }, `${destination.knowledgeBaseId}:${destination.documentId ?? destination.documentTitle}:${index}`)) }),
    state.status === "failed" && state.error && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dsh-knowledge-writeback-error", role: "alert", children: state.error }),
    readError && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dsh-knowledge-writeback-error", role: "status", children: readError })
  ] });
}
function createKnowledgeWorkspaceController(client, beforeOpen) {
  const listeners = /* @__PURE__ */ new Set();
  let disposeWorkspace;
  let target;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const close = () => {
    if (disposeWorkspace === void 0) return;
    const dispose = disposeWorkspace;
    disposeWorkspace = void 0;
    dispose();
    notify();
  };
  let controller;
  const open = () => {
    if (disposeWorkspace !== void 0) return;
    beforeOpen();
    activatePluginWorkspace(PLUGIN_ID);
    disposeWorkspace = registerMainPanel(client, PLUGIN_ID, -1, (props) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(KnowledgeWorkspace, { ...props, client, workspace: controller }), close);
  };
  controller = {
    isOpen: () => disposeWorkspace !== void 0,
    open: () => {
      target = void 0;
      open();
      notify();
    },
    toggle: () => {
      if (disposeWorkspace !== void 0) return close();
      target = void 0;
      open();
      notify();
    },
    openDocument: (nextTarget) => {
      target = nextTarget;
      open();
      notify();
    },
    currentTarget: () => target,
    close,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
  return controller;
}
function KnowledgeConnectionCard() {
  const [current, setCurrent] = (0, import_react6.useState)();
  const [loadState, setLoadState] = (0, import_react6.useState)("loading");
  const [loadError, setLoadError] = (0, import_react6.useState)("");
  const [open, setOpen] = (0, import_react6.useState)(false);
  const [backend, setBackend] = (0, import_react6.useState)("local");
  const [remoteUrl, setRemoteUrl] = (0, import_react6.useState)("");
  const [remoteToken, setRemoteToken] = (0, import_react6.useState)("");
  const [timeout, setTimeoutValue] = (0, import_react6.useState)("10000");
  const [dirty, setDirty] = (0, import_react6.useState)(false);
  const [saving, setSaving] = (0, import_react6.useState)(false);
  const [message3, setMessage] = (0, import_react6.useState)();
  const load = (0, import_react6.useCallback)(async (signal) => {
    setLoadState("loading");
    setLoadError("");
    try {
      const value = await requestConnection("GET", void 0, signal);
      setCurrent(value);
      setLoadState("ready");
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(connectionErrorMessage(error));
      setLoadState("error");
    }
  }, []);
  (0, import_react6.useEffect)(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);
  (0, import_react6.useEffect)(() => {
    if (dirty || current === void 0) return;
    setBackend(current.backend);
    setRemoteUrl(current.remoteUrl ?? "");
    setTimeoutValue(String(current.remoteTimeoutMs ?? 1e4));
  }, [current, dirty]);
  const timeoutNumber = Number(timeout);
  const urlError = backend === "remote" ? validateRemoteUrl(remoteUrl) : void 0;
  const tokenError = backend === "remote" && !current?.tokenConfigured && remoteToken.trim().length === 0 ? "\u9996\u6B21\u8FDE\u63A5\u5FC5\u987B\u586B\u5199\u5BA2\u6237\u7AEF\u4EE4\u724C\u3002" : remoteToken.length > 0 && remoteToken.trim().length < 24 ? "\u4EE4\u724C\u81F3\u5C11\u9700\u8981 24 \u4E2A\u5B57\u7B26\u3002" : void 0;
  const timeoutError = !Number.isInteger(timeoutNumber) || timeoutNumber < 100 || timeoutNumber > 12e4 ? "\u8D85\u65F6\u5FC5\u987B\u662F 100 \u5230 120000 \u6BEB\u79D2\u4E4B\u95F4\u7684\u6574\u6570\u3002" : void 0;
  const invalid = urlError !== void 0 || tokenError !== void 0 || timeoutError !== void 0;
  const edit = (action) => {
    action();
    setDirty(true);
    setMessage(void 0);
  };
  const reset = () => {
    setBackend(current?.backend ?? "local");
    setRemoteUrl(current?.remoteUrl ?? "");
    setRemoteToken("");
    setTimeoutValue(String(current?.remoteTimeoutMs ?? 1e4));
    setDirty(false);
    setMessage(void 0);
  };
  const save = async () => {
    if (!dirty || invalid || !current?.writable || saving) return;
    setSaving(true);
    setMessage(void 0);
    try {
      const next = await requestConnection("PUT", {
        backend,
        remoteTimeoutMs: timeoutNumber,
        ...backend === "remote" ? { remoteUrl: remoteUrl.trim() } : {},
        ...backend === "remote" && remoteToken.trim().length > 0 ? { remoteToken: remoteToken.trim() } : {}
      });
      setCurrent(next);
      setRemoteToken("");
      setDirty(false);
      setMessage({
        kind: "success",
        text: backend === "remote" ? "\u5DF2\u9A8C\u8BC1\u5E76\u5207\u6362\u81F3\u8FDC\u7A0B\u77E5\u8BC6\u5E93\u3002" : "\u5DF2\u5207\u6362\u81F3\u672C\u5730\u77E5\u8BC6\u5E93\u3002"
      });
    } catch (error) {
      setMessage({ kind: "error", text: connectionErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("li", { className: `dsh-knowledge-settings-card${open ? " dsh-knowledge-settings-card--open" : ""}`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "dsh-knowledge-settings-header", "aria-expanded": open, onClick: () => {
      setOpen((value) => !value);
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "\u77E5\u8BC6\u5E93\u8FDE\u63A5" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { children: "\u9009\u62E9\u672C\u673A\u77E5\u8BC6\u5E93\uFF0C\u6216\u8FDE\u63A5\u4E00\u53F0\u4E2D\u592E DSH \u77E5\u8BC6\u5E93" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { className: "dsh-knowledge-settings-summary", children: [
        loadState === "loading" ? "\u8BFB\u53D6\u4E2D" : loadState === "error" ? "\u8FDE\u63A5\u5165\u53E3" : current?.backend === "remote" ? "\u8FDC\u7A0B" : "\u672C\u5730",
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("i", { "aria-hidden": "true" })
      ] })
    ] }),
    open && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "dsh-knowledge-settings-body", children: loadState === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dsh-knowledge-settings-note", role: "status", children: "\u6B63\u5728\u8BFB\u53D6\u8FDE\u63A5\u914D\u7F6E\u2026" }) : loadState === "error" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-knowledge-settings-load-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: loadError }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", onClick: () => {
        void load();
      }, children: "\u91CD\u65B0\u8BFB\u53D6" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("fieldset", { className: "dsh-knowledge-source-picker", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("legend", { children: "\u77E5\u8BC6\u5E93\u6765\u6E90" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: backend === "local" ? "is-selected" : "", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { type: "radio", name: "dsh-knowledge-backend", checked: backend === "local", onChange: () => edit(() => {
            setBackend("local");
          }) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "\u672C\u5730" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { children: "\u6570\u636E\u4FDD\u5B58\u5728\u5F53\u524D DSH \u7684 SQLite \u4E2D" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: `${backend === "remote" ? "is-selected" : ""}${!current?.canSwitchRemote ? " is-disabled" : ""}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { type: "radio", name: "dsh-knowledge-backend", checked: backend === "remote", disabled: !current?.canSwitchRemote, onChange: () => edit(() => {
            setBackend("remote");
          }) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: "\u8FDC\u7A0B" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { children: "\u53EC\u56DE\u548C\u56DE\u5199\u7EDF\u4E00\u4F7F\u7528\u4E2D\u592E\u77E5\u8BC6\u5E93" })
          ] })
        ] })
      ] }),
      !current?.canSwitchRemote && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dsh-knowledge-settings-note", children: "\u5F53\u524D\u5B9E\u4F8B\u662F\u4E2D\u592E\u77E5\u8BC6\u5E93\u670D\u52A1\uFF0C\u4E0D\u80FD\u518D\u5207\u6362\u5230\u53E6\u4E00\u53F0\u8FDC\u7A0B\u670D\u52A1\u3002" }),
      backend === "remote" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-knowledge-remote-fields", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { htmlFor: "dsh-knowledge-remote-url", children: [
          "\u670D\u52A1\u5668\u5730\u5740",
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { id: "dsh-knowledge-remote-url", type: "url", value: remoteUrl, placeholder: "https://example.com/knowledge-api/v1", autoComplete: "url", onChange: (event) => edit(() => {
            setRemoteUrl(event.target.value);
          }), "aria-invalid": urlError !== void 0, "aria-describedby": urlError ? "dsh-knowledge-url-error" : void 0 }),
          urlError && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { id: "dsh-knowledge-url-error", className: "dsh-knowledge-field-error", children: urlError })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { htmlFor: "dsh-knowledge-remote-token", children: [
          "\u5BA2\u6237\u7AEF\u4EE4\u724C",
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { id: "dsh-knowledge-remote-token", type: "password", value: remoteToken, placeholder: current?.tokenConfigured ? "\u5DF2\u4FDD\u5B58\uFF1B\u7559\u7A7A\u5219\u4FDD\u6301\u4E0D\u53D8" : "\u7C98\u8D34\u5BA2\u6237\u7AEF\u4EE4\u724C", autoComplete: "new-password", onChange: (event) => edit(() => {
            setRemoteToken(event.target.value);
          }), "aria-invalid": tokenError !== void 0, "aria-describedby": "dsh-knowledge-token-help" }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { id: "dsh-knowledge-token-help", className: tokenError ? "dsh-knowledge-field-error" : void 0, children: tokenError ?? (current?.tokenConfigured ? "\u4EE4\u724C\u5DF2\u5B89\u5168\u4FDD\u5B58\uFF0C\u9875\u9762\u65E0\u6CD5\u8BFB\u53D6\uFF1B\u8F93\u5165\u65B0\u4EE4\u724C\u53EF\u8986\u76D6\u3002" : "\u4EE4\u724C\u4FDD\u5B58\u540E\u4E0D\u53EF\u8BFB\u53D6\uFF0C\u53EA\u80FD\u8986\u76D6\u3002") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "dsh-knowledge-timeout-field", htmlFor: "dsh-knowledge-timeout", children: [
        "\u8BF7\u6C42\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF09",
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { id: "dsh-knowledge-timeout", type: "number", min: "100", max: "120000", step: "100", value: timeout, onChange: (event) => edit(() => {
          setTimeoutValue(event.target.value);
        }), "aria-invalid": timeoutError !== void 0 }),
        timeoutError && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("small", { className: "dsh-knowledge-field-error", children: timeoutError })
      ] }),
      !current?.writable && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "dsh-knowledge-settings-note", children: "\u5F53\u524D\u63D2\u4EF6\u6CA1\u6709\u914D\u7F6E\u6301\u4E45\u5316\u8DEF\u5F84\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u8FDE\u63A5\u3002" }),
      message3 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: `dsh-knowledge-settings-message is-${message3.kind}`, role: message3.kind === "error" ? "alert" : "status", "aria-live": "polite", children: message3.text }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-knowledge-settings-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", onClick: reset, disabled: !dirty || saving, children: "\u653E\u5F03\u66F4\u6539" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "is-primary", onClick: () => {
          void save();
        }, disabled: !dirty || invalid || saving || !current?.writable, children: saving ? "\u6B63\u5728\u9A8C\u8BC1\u2026" : "\u9A8C\u8BC1\u5E76\u8FDE\u63A5" })
      ] })
    ] }) })
  ] });
}
function validateRemoteUrl(value) {
  try {
    const url = new URL(value.trim());
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return "\u8FDC\u7A0B\u77E5\u8BC6\u5E93\u5FC5\u987B\u4F7F\u7528 HTTPS\u3002";
    return void 0;
  } catch {
    return "\u8BF7\u8F93\u5165\u5B8C\u6574\u7684\u77E5\u8BC6\u5E93 API \u5730\u5740\u3002";
  }
}
function connectionErrorMessage(error) {
  const message3 = error instanceof Error ? error.message : String(error);
  if (message3.includes("Failed to fetch")) return "\u65E0\u6CD5\u8BBF\u95EE\u63D2\u4EF6\u8FDE\u63A5\u63A5\u53E3\uFF0C\u8BF7\u786E\u8BA4\u63D2\u4EF6\u670D\u52A1\u5DF2\u52A0\u8F7D\u3002";
  return message3 || "\u8FDE\u63A5\u914D\u7F6E\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u5730\u5740\u3001\u4EE4\u724C\u548C DSH \u65E5\u5FD7\u3002";
}
async function requestConnection(method, body, signal) {
  const response = await fetch(CONNECTION_CONTROL_PATH, {
    method,
    headers: { accept: "application/json", ...body === void 0 ? {} : { "content-type": "application/json" } },
    ...body === void 0 ? {} : { body: JSON.stringify(body) },
    ...signal === void 0 ? {} : { signal }
  });
  const payload = await response.json().catch(() => void 0);
  if (!response.ok) {
    const message3 = payload !== null && typeof payload === "object" && typeof payload.error === "string" ? payload.error : `\u8FDE\u63A5\u63A5\u53E3\u8FD4\u56DE HTTP ${response.status}`;
    throw new Error(message3);
  }
  if (!isConnectionView(payload)) throw new Error("\u63D2\u4EF6\u8FDE\u63A5\u63A5\u53E3\u8FD4\u56DE\u4E86\u65E0\u6548\u6570\u636E\u3002");
  cachedConnectionView = payload;
  return payload;
}
function isConnectionView(value) {
  if (value === null || typeof value !== "object") return false;
  const item = value;
  return (item.backend === "local" || item.backend === "remote") && Number.isInteger(item.remoteTimeoutMs) && typeof item.tokenConfigured === "boolean" && typeof item.canSwitchRemote === "boolean" && typeof item.writable === "boolean" && typeof item.managementAvailable === "boolean" && (!item.managementAvailable || isManagementPath(item.managementPath));
}
function isManagementPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}
function KnowledgeLauncher({ wide, useSessions, workspace, activity, docked }) {
  const [open, setOpen] = (0, import_react6.useState)(workspace.isOpen());
  const currentSessionId = useSessions((state) => availableActivitySession(state, docked));
  const [activityOpen, setActivityOpen] = (0, import_react6.useState)(currentSessionId === void 0 ? false : activity.isOpen(currentSessionId));
  (0, import_react6.useEffect)(() => workspace.subscribe(() => {
    setOpen(workspace.isOpen());
  }), [workspace]);
  (0, import_react6.useEffect)(() => {
    const sync = () => {
      setActivityOpen(currentSessionId === void 0 ? false : activity.isOpen(currentSessionId));
    };
    sync();
    return activity.subscribe(sync);
  }, [activity, currentSessionId]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: `dsh-knowledge-launcher${wide ? "" : " dsh-knowledge-launcher--rail"}`, role: "group", "aria-label": "\u77E5\u8BC6\u5E93\u5165\u53E3", children: [
    wide && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
      "button",
      {
        type: "button",
        className: `dsh-knowledge-trigger${wide ? "" : " dsh-knowledge-trigger--rail"}${open ? " is-active" : ""}`,
        "aria-label": open ? "\u8FD4\u56DE\u5BF9\u8BDD" : "\u6253\u5F00\u77E5\u8BC6\u5E93\u5DE5\u4F5C\u533A",
        "aria-pressed": open,
        title: open ? "\u8FD4\u56DE\u5BF9\u8BDD" : "\u6253\u5F00\u77E5\u8BC6\u5E93\u5DE5\u4F5C\u533A",
        onClick: () => workspace.toggle(),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconDataOutline16, { size: wide ? 16 : 18 }),
          wide && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: "\u77E5\u8BC6\u5E93" })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "button",
      {
        type: "button",
        className: `dsh-knowledge-trigger dsh-knowledge-panel-trigger${activityOpen ? " is-active" : ""}`,
        "aria-label": activityOpen ? "\u6536\u8D77\u4F1A\u8BDD\u77E5\u8BC6\u5E93" : "\u5C55\u5F00\u4F1A\u8BDD\u77E5\u8BC6\u5E93",
        "aria-expanded": activityOpen,
        disabled: currentSessionId === void 0,
        title: currentSessionId === void 0 ? "\u8FDB\u5165\u4F1A\u8BDD\u540E\u53EF\u5C55\u5F00\u77E5\u8BC6\u4FA7\u680F" : activityOpen ? "\u6536\u8D77\u4F1A\u8BDD\u77E5\u8BC6\u5E93" : "\u5C55\u5F00\u4F1A\u8BDD\u77E5\u8BC6\u5E93",
        onClick: () => {
          if (currentSessionId !== void 0) activity.toggle(currentSessionId);
        },
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconPanelLeftOutline16, { size: 16, className: "dsh-knowledge-panel-right-icon" })
      }
    )
  ] });
}
function KnowledgeWorkspace({
  sessionId: scopedSessionId,
  useSessions,
  client,
  workspace
}) {
  const cachedManagementPath = cachedConnectionView?.managementAvailable ? cachedConnectionView.managementPath : void 0;
  const [panelState, setPanelState] = (0, import_react6.useState)(cachedConnectionView === void 0 ? "loading" : cachedManagementPath === void 0 ? "unavailable" : "ready");
  const [managementPath, setManagementPath] = (0, import_react6.useState)(cachedManagementPath);
  const [panelError, setPanelError] = (0, import_react6.useState)("");
  const [target, setTarget] = (0, import_react6.useState)(workspace.currentTarget());
  const selectedSessionId = useSessions((state) => state.current);
  const sessionId = scopedSessionId ?? selectedSessionId;
  const projectId = useSessions((state) => sessionId === void 0 ? void 0 : state.byId[sessionId]?.cwd);
  const knowledgeUrl = managementPath === void 0 ? void 0 : knowledgePanelUrl(managementPath, sessionId, projectId, target);
  const frame = (0, import_react6.useRef)(null);
  const themeFrame = (0, import_react6.useRef)(0);
  const loadManagement = (0, import_react6.useCallback)(async (background = false) => {
    if (!background) setPanelState("loading");
    setPanelError("");
    try {
      const connection = await requestConnection("GET");
      if (!connection.managementAvailable || connection.managementPath === void 0) {
        setManagementPath(void 0);
        setPanelState("unavailable");
        return;
      }
      setManagementPath(connection.managementPath);
      setPanelState("ready");
    } catch (error) {
      setManagementPath(void 0);
      setPanelError(connectionErrorMessage(error));
      setPanelState("error");
    }
  }, []);
  (0, import_react6.useEffect)(() => {
    void loadManagement(cachedConnectionView !== void 0);
  }, [loadManagement]);
  (0, import_react6.useEffect)(() => workspace.subscribe(() => {
    setTarget(workspace.currentTarget());
  }), [workspace]);
  const sendTheme = (0, import_react6.useCallback)(() => {
    const currentFrame = frame.current;
    if (currentFrame === null) return;
    const target2 = currentFrame.contentWindow;
    if (target2 === null) return;
    target2.postMessage(
      createKnowledgeHostTheme(client.theme.getTheme()),
      frameOrigin(currentFrame) ?? "*"
    );
  }, [client]);
  const scheduleTheme = (0, import_react6.useCallback)(() => {
    if (themeFrame.current !== 0) window.cancelAnimationFrame(themeFrame.current);
    themeFrame.current = window.requestAnimationFrame(() => {
      themeFrame.current = 0;
      sendTheme();
    });
  }, [sendTheme]);
  (0, import_react6.useEffect)(() => {
    const off = client.on("theme/change", scheduleTheme);
    const onMessage = (event) => {
      const currentFrame = frame.current;
      if (event.source !== currentFrame?.contentWindow) return;
      const expectedOrigin = frameOrigin(currentFrame);
      if (expectedOrigin !== void 0 && event.origin !== expectedOrigin) return;
      const data = event.data;
      if (data?.type === KNOWLEDGE_THEME_READY_MESSAGE && data.version === KNOWLEDGE_THEME_PROTOCOL_VERSION) sendTheme();
    };
    window.addEventListener("message", onMessage);
    scheduleTheme();
    return () => {
      off();
      window.removeEventListener("message", onMessage);
      if (themeFrame.current !== 0) window.cancelAnimationFrame(themeFrame.current);
    };
  }, [client, scheduleTheme, sendTheme]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "dsh-knowledge-workspace", "data-knowledge-surface": "workspace", "aria-labelledby": "dsh-knowledge-workspace-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("header", { className: "dsh-knowledge-workspace-header", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", "data-knowledge-workspace-close": true, onClick: workspace.close, "aria-label": "\u8FD4\u56DE\u4F1A\u8BDD", title: "\u8FD4\u56DE\u4F1A\u8BDD", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconChevronLeftOutline14, { size: 15 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.IconDataOutline16, { size: 18 }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h2", { id: "dsh-knowledge-workspace-title", children: "\u77E5\u8BC6\u5E93" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: "\u6587\u6863\u3001\u5BA1\u6838\u3001\u6302\u8F7D\u4E0E\u8BBF\u95EE\u7BA1\u7406" })
      ] })
    ] }) }),
    panelState === "ready" && knowledgeUrl !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("iframe", { ref: frame, className: "dsh-knowledge-frame", src: knowledgeUrl, title: "\u77E5\u8BC6\u5E93\u7BA1\u7406\u53F0", onLoad: sendTheme }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "dsh-knowledge-panel-state", role: panelState === "error" ? "alert" : "status", "aria-live": "polite", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "dsh-knowledge-panel-state-icon", "aria-hidden": "true", children: panelState === "loading" ? "\xB7\xB7\xB7" : panelState === "error" ? "!" : "\u2014" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: panelState === "loading" ? "\u6B63\u5728\u6253\u5F00\u77E5\u8BC6\u5E93\u2026" : panelState === "error" ? "\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\u77E5\u8BC6\u5E93" : "\u8FD9\u53F0 DSH \u672A\u542F\u7528\u77E5\u8BC6\u5E93\u7BA1\u7406\u53F0" }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: panelState === "loading" ? "\u6B63\u5728\u786E\u8BA4\u5F53\u524D\u5B9E\u4F8B\u662F\u5426\u63D0\u4F9B\u7BA1\u7406\u9875\u9762\u3002" : panelState === "error" ? panelError : "\u672C\u5730\u53EC\u56DE\u548C\u56DE\u5199\u4ECD\u53EF\u4F7F\u7528\u3002\u5F53\u524D profile \u5DF2\u663E\u5F0F\u5173\u95ED exposeWeb\uFF1B\u91CD\u65B0\u542F\u7528\u540E\u5373\u53EF\u5728\u8FD9\u91CC\u7BA1\u7406\u3002\u4F7F\u7528\u8FDC\u7A0B\u77E5\u8BC6\u5E93\u65F6\uFF0C\u8BF7\u524D\u5F80\u4E2D\u592E DSH \u7684\u77E5\u8BC6\u5E93\u7BA1\u7406\u53F0\u3002" }),
        panelState === "error" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", onClick: () => {
          void loadManagement();
        }, children: "\u91CD\u8BD5" })
      ] })
    ] })
  ] });
}
function knowledgePanelUrl(managementPath, sessionId, projectId, target) {
  const params = new URLSearchParams();
  if (sessionId !== void 0) params.set("sessionId", sessionId);
  if (projectId !== void 0) params.set("projectId", projectId);
  if (target !== void 0) {
    if (target.view === "writeback") {
      params.set("view", "writeback");
      params.set("sessionId", target.sessionId);
    } else if (target.view === "notes") {
      params.set("view", "notes");
      if (target.noteId !== void 0) params.set("noteId", target.noteId);
    } else {
      params.set("knowledgeBaseId", target.knowledgeBaseId);
      params.set("documentId", target.documentId);
    }
  }
  const query = params.toString();
  return query.length === 0 ? managementPath : `${managementPath}${managementPath.includes("?") ? "&" : "?"}${query}`;
}
function frameOrigin(frame) {
  try {
    const origin = new URL(frame.src).origin;
    return origin === "null" ? void 0 : origin;
  } catch {
    return void 0;
  }
}
function installStyles() {
  const previous = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`);
  previous?.remove();
  const style = document.createElement("style");
  style.dataset.plugin = PLUGIN_ID;
  style.dataset.pluginCss = STYLE_ID;
  const scope = ":is(.dsh-knowledge-trigger, .dsh-knowledge-activity-panel, .dsh-knowledge-workspace, .dsh-knowledge-settings-card, .dsh-knowledge-writeback-notice)";
  style.textContent = knowledgeDesignCss(scope, "body[data-ds-dark-theme] " + scope, false) + client_default + knowledge_activity_default;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}
/*! Bundled license information:

dompurify/dist/purify.es.mjs:
  (*! @license DOMPurify 3.4.14 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.14/LICENSE *)
*/
return module.exports; } });
//# sourceMappingURL=client.js.map
