import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconChevronLeftOutline14, IconChevronDownOutline14, IconCloseOutline16, IconDatabaseOutline16, IconDataOutline16, IconRefreshOutline14, IconSearchOutline16, IconFullscreenOutline16, } from '@deepseek-ai/dsh-client-ui-primitives';
import { loadKnowledgeDocument, loadKnowledgeDocumentIndex, loadMountedKnowledge, } from './knowledge-activity-api.js';
import { KnowledgeActivityNotes } from './knowledge-activity-notes.js';
import { LatestRequest } from './latest-request.js';
import { renderMarkdown } from './web-markdown-preview.js';
export function KnowledgeActivityPanel(props) {
    const sessionId = String(props.sessionId);
    const projectId = props.useSessions((state) => state.byId[props.sessionId]?.cwd);
    const initial = props.controller.selection(sessionId);
    const [mode, setMode] = useState(initial.mode ?? 'knowledge');
    const [mounts, setMounts] = useState([]);
    const [selectedBaseId, setSelectedBaseId] = useState(initial.knowledgeBaseId);
    const [selectedDocumentId, setSelectedDocumentId] = useState(initial.documentId);
    const [documents, setDocuments] = useState([]);
    const [documentValue, setDocumentValue] = useState();
    const [queryInput, setQueryInput] = useState('');
    const [query, setQuery] = useState('');
    const [mountState, setMountState] = useState('loading');
    const [listState, setListState] = useState('idle');
    const [documentState, setDocumentState] = useState('idle');
    const [documentRefresh, setDocumentRefresh] = useState(0);
    const [error, setError] = useState('');
    const [nextCursor, setNextCursor] = useState();
    const [baseMenuOpen, setBaseMenuOpen] = useState(false);
    const indexRequest = useRef(new LatestRequest());
    const mountRequest = useRef(new LatestRequest());
    const scopeRef = useRef(null);
    useEffect(() => {
        if (!baseMenuOpen)
            return;
        const closeOutside = (event) => {
            if (!scopeRef.current?.contains(event.target))
                setBaseMenuOpen(false);
        };
        const closeOnEscape = (event) => {
            if (event.key === 'Escape')
                setBaseMenuOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [baseMenuOpen]);
    const refreshMounts = useCallback(async () => {
        const signal = mountRequest.current.start();
        setMountState('loading');
        setError('');
        try {
            const next = await loadMountedKnowledge(sessionId, projectId, signal);
            if (signal.aborted)
                return;
            setMounts(next);
            const current = props.controller.selection(sessionId);
            const selected = next.some(item => item.knowledgeBaseId === current.knowledgeBaseId)
                ? current.knowledgeBaseId
                : next[0]?.knowledgeBaseId;
            props.controller.select(sessionId, {
                knowledgeBaseId: selected,
                documentId: selected === current.knowledgeBaseId ? current.documentId : undefined,
            });
            setSelectedBaseId(selected);
            if (selected !== current.knowledgeBaseId) {
                setSelectedDocumentId(undefined);
                setDocumentValue(undefined);
            }
            setMountState('ready');
        }
        catch (reason) {
            if (signal?.aborted)
                return;
            setMountState('error');
            setError(message(reason));
        }
    }, [projectId, props.controller, sessionId]);
    useEffect(() => {
        void refreshMounts();
        return () => { mountRequest.current.cancel(); };
    }, [refreshMounts]);
    const loadIndex = useCallback(async (cursor, append = false) => {
        const signal = indexRequest.current.start();
        if (mounts.length === 0 || (query.length === 0 && selectedBaseId === undefined)) {
            setDocuments([]);
            setNextCursor(undefined);
            setListState('ready');
            return;
        }
        setListState('loading');
        setError('');
        try {
            const result = await loadKnowledgeDocumentIndex({
                sessionId,
                ...projectId === undefined ? {} : { projectId },
                knowledgeBaseIds: query ? mounts.map(item => item.knowledgeBaseId) : [selectedBaseId],
                ...query ? { query } : {},
                ...cursor === undefined ? {} : { cursor },
                ...signal === undefined ? {} : { signal },
            });
            if (signal.aborted)
                return;
            setDocuments(current => append ? [...current, ...result.items] : result.items);
            setNextCursor(result.nextCursor);
            setListState('ready');
        }
        catch (reason) {
            if (signal?.aborted)
                return;
            setListState('error');
            setError(message(reason));
        }
    }, [mounts, projectId, query, selectedBaseId, sessionId]);
    useEffect(() => {
        void loadIndex();
        return () => { indexRequest.current.cancel(); };
    }, [loadIndex]);
    useEffect(() => {
        if (selectedDocumentId === undefined) {
            setDocumentValue(undefined);
            setDocumentState('idle');
            return;
        }
        const controller = new AbortController();
        setDocumentState('loading');
        setError('');
        void loadKnowledgeDocument({
            id: selectedDocumentId,
            sessionId,
            ...projectId === undefined ? {} : { projectId },
            signal: controller.signal,
        }).then(value => {
            if (controller.signal.aborted)
                return;
            setDocumentValue(value);
            setDocumentState('ready');
        }).catch(reason => {
            if (controller.signal.aborted)
                return;
            setDocumentState('error');
            setError(message(reason));
        });
        return () => { controller.abort(); };
    }, [documentRefresh, projectId, selectedDocumentId, sessionId]);
    const selectBase = (knowledgeBaseId) => {
        setBaseMenuOpen(false);
        setSelectedBaseId(knowledgeBaseId);
        setSelectedDocumentId(undefined);
        setDocumentValue(undefined);
        setQueryInput('');
        setQuery('');
        props.controller.select(sessionId, { mode: 'knowledge', knowledgeBaseId, documentId: undefined });
    };
    const selectDocument = (document) => {
        setSelectedBaseId(document.knowledgeBaseId);
        setSelectedDocumentId(document.id);
        props.controller.select(sessionId, {
            mode: 'knowledge',
            knowledgeBaseId: document.knowledgeBaseId,
            documentId: document.id,
        });
    };
    const closeDocument = () => {
        setSelectedDocumentId(undefined);
        setDocumentValue(undefined);
        props.controller.select(sessionId, {
            mode: 'knowledge',
            documentId: undefined,
            ...selectedBaseId === undefined ? {} : { knowledgeBaseId: selectedBaseId },
        });
    };
    const submitSearch = (event) => {
        event.preventDefault();
        setSelectedDocumentId(undefined);
        setDocumentValue(undefined);
        props.controller.select(sessionId, { documentId: undefined });
        setQuery(queryInput.trim());
    };
    const clearSearch = () => {
        setQueryInput('');
        setQuery('');
    };
    const openWorkspace = () => {
        const noteId = props.controller.selection(sessionId).noteDocumentId;
        props.controller.openWorkspace(mode === 'notes'
            ? { view: 'notes', ...(noteId === undefined ? {} : { noteId }) }
            : documentValue === undefined ? undefined : {
                knowledgeBaseId: documentValue.knowledgeBaseId,
                documentId: documentValue.id,
            });
    };
    const selectMode = (nextMode) => {
        setMode(nextMode);
        setBaseMenuOpen(false);
        props.controller.select(sessionId, { ...props.controller.selection(sessionId), mode: nextMode });
    };
    return _jsxs("section", { className: "dsh-knowledge-activity-panel", "data-knowledge-surface": "activity", "aria-label": "\u4F1A\u8BDD\u77E5\u8BC6\u5E93", children: [_jsxs("header", { className: "dsh-knowledge-activity-header", children: [_jsxs("div", { className: "dsh-knowledge-activity-title", children: [_jsx("span", { className: "dsh-knowledge-activity-mark", children: _jsx(IconDatabaseOutline16, { size: 17 }) }), _jsxs("span", { children: [_jsx("strong", { children: "\u77E5\u8BC6\u5E93" }), _jsxs("small", { children: ["\u5F53\u524D\u4F1A\u8BDD \u00B7 ", shortId(sessionId)] })] })] }), _jsxs("div", { className: "dsh-knowledge-activity-header-actions", children: [_jsx("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5728\u5B8C\u6574\u5DE5\u4F5C\u533A\u4E2D\u6253\u5F00", title: "\u5B8C\u6574\u5DE5\u4F5C\u533A", onClick: openWorkspace, children: _jsx(IconFullscreenOutline16, { size: 16 }) }), _jsx("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5173\u95ED\u4F1A\u8BDD\u77E5\u8BC6\u5E93", title: "\u5173\u95ED", onClick: () => props.controller.close(sessionId), children: _jsx(IconCloseOutline16, { size: 16 }) })] })] }), _jsxs("nav", { className: "dsh-knowledge-activity-tabs", "aria-label": "\u77E5\u8BC6\u5E93\u5185\u5BB9\u7C7B\u578B", children: [_jsxs("button", { type: "button", className: mode === 'knowledge' ? 'is-active' : '', "aria-pressed": mode === 'knowledge', onClick: () => selectMode('knowledge'), children: [_jsx(IconDatabaseOutline16, { size: 15 }), "\u77E5\u8BC6\u6587\u6863"] }), _jsxs("button", { type: "button", className: mode === 'notes' ? 'is-active' : '', "aria-pressed": mode === 'notes', onClick: () => selectMode('notes'), children: [_jsx(IconDataOutline16, { size: 15 }), "\u7B14\u8BB0\u6587\u6863"] })] }), mode === 'notes'
                ? _jsx(KnowledgeActivityNotes, { sessionId: sessionId, projectId: projectId, controller: props.controller })
                : selectedDocumentId === undefined
                    ? _jsxs("div", { className: "dsh-knowledge-activity-browser", children: [_jsxs("form", { className: "dsh-knowledge-activity-search", role: "search", onSubmit: submitSearch, children: [_jsx(IconSearchOutline16, { size: 16, "aria-hidden": "true" }), _jsx("input", { "aria-label": "\u641C\u7D22\u5F53\u524D\u4F1A\u8BDD\u77E5\u8BC6\u6587\u6863", value: queryInput, placeholder: "\u641C\u7D22\u5DF2\u6302\u8F7D\u77E5\u8BC6\u2026", onChange: event => setQueryInput(event.target.value) }), queryInput && _jsx("button", { type: "button", onClick: clearSearch, "aria-label": "\u6E05\u9664\u641C\u7D22", children: _jsx(IconCloseOutline16, { size: 14 }) })] }), mountState === 'loading' ? _jsx(ActivityState, { label: "\u6B63\u5728\u8BFB\u53D6\u4F1A\u8BDD\u6302\u8F7D\u2026" })
                                : mountState === 'error' ? _jsx(ActivityError, { message: error, onRetry: () => { void refreshMounts(); } })
                                    : mounts.length === 0 ? _jsx(ActivityEmpty, { title: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u6302\u8F7D\u77E5\u8BC6\u5E93", description: "\u5728\u5B8C\u6574\u5DE5\u4F5C\u533A\u4E2D\u6302\u8F7D\u540E\uFF0C\u5C31\u80FD\u5728\u8FD9\u91CC\u968F\u624B\u67E5\u9605\u6587\u6863\u3002" })
                                        : _jsxs(_Fragment, { children: [_jsxs("div", { ref: scopeRef, className: "dsh-knowledge-activity-scope", children: [_jsxs("button", { type: "button", className: "dsh-knowledge-activity-scope-trigger", "aria-haspopup": "listbox", "aria-expanded": baseMenuOpen, onClick: () => setBaseMenuOpen(value => !value), children: [_jsx("span", { className: "dsh-knowledge-activity-scope-icon", children: _jsx(IconDatabaseOutline16, { size: 15 }) }), _jsxs("span", { children: [_jsx("small", { children: "\u5F53\u524D\u77E5\u8BC6\u5E93" }), _jsx("strong", { children: mounts.find(item => item.knowledgeBaseId === selectedBaseId)?.base.name })] }), _jsx(IconChevronDownOutline14, { size: 14, className: baseMenuOpen ? 'is-open' : '' })] }), baseMenuOpen && _jsx("div", { className: "dsh-knowledge-activity-scope-menu", role: "listbox", "aria-label": "\u5207\u6362\u77E5\u8BC6\u5E93", children: mounts.map(mount => _jsxs("button", { type: "button", role: "option", "aria-selected": selectedBaseId === mount.knowledgeBaseId, className: selectedBaseId === mount.knowledgeBaseId ? 'is-active' : '', onClick: () => selectBase(mount.knowledgeBaseId), children: [_jsx(IconDataOutline16, { size: 15 }), _jsxs("span", { children: [_jsx("strong", { children: mount.base.name }), _jsx("small", { children: mount.inheritedFrom === 'project' ? '项目挂载' : '会话挂载' })] })] }, mount.knowledgeBaseId)) })] }), _jsxs("div", { className: "dsh-knowledge-activity-list-heading", children: [_jsxs("span", { children: [_jsx("strong", { children: query ? `“${query}” 的结果` : '知识文档' }), _jsx("small", { children: query ? '搜索全部已挂载知识库' : `当前显示 ${documents.length} 项` })] }), _jsx("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5237\u65B0\u6587\u6863", title: "\u5237\u65B0", onClick: () => { void loadIndex(); }, children: _jsx(IconRefreshOutline14, { size: 14 }) })] }), _jsx("div", { className: "dsh-knowledge-activity-list", "aria-busy": listState === 'loading', children: listState === 'loading' && documents.length === 0 ? _jsx(ActivityState, { label: "\u6B63\u5728\u8BFB\u53D6\u6587\u6863\u2026" })
                                                        : listState === 'error' ? _jsx(ActivityError, { message: error, onRetry: () => { void loadIndex(); } })
                                                            : documents.length === 0 ? _jsx(ActivityEmpty, { title: query ? '没有找到相关文档' : '这里还没有知识文档', description: query ? '换个关键词，或清除搜索后浏览目录。' : '审核通过或直接回写的知识会出现在这里。' })
                                                                : _jsxs(_Fragment, { children: [documents.map(document => _jsx(DocumentRow, { document: document, baseName: query ? mounts.find(item => item.knowledgeBaseId === document.knowledgeBaseId)?.base.name : undefined, onClick: () => selectDocument(document) }, document.id)), nextCursor && _jsx("button", { type: "button", className: "dsh-knowledge-activity-load-more", disabled: listState === 'loading', onClick: () => { void loadIndex(nextCursor, true); }, children: listState === 'loading' ? '正在加载…' : '加载更多' })] }) })] })] })
                    : _jsx(DocumentReader, { value: documentValue, state: documentState, error: error, onBack: closeDocument, onRetry: () => setDocumentRefresh(value => value + 1) })] });
}
function DocumentRow({ document, baseName, onClick }) {
    const stateLabel = document.documentState === 'resolved' ? '已解决' : document.documentState === 'complete' ? '已完成' : undefined;
    return _jsxs("button", { type: "button", className: "dsh-knowledge-activity-row", onClick: onClick, children: [_jsx("span", { className: "dsh-knowledge-activity-row-icon", children: _jsx(IconDataOutline16, { size: 16 }) }), _jsxs("span", { className: "dsh-knowledge-activity-row-copy", children: [_jsx("strong", { children: document.title }), _jsx("small", { children: baseName ? `${baseName} · ${document.relPath}` : document.relPath })] }), _jsxs("span", { className: "dsh-knowledge-activity-row-meta", children: [stateLabel && _jsx("em", { children: stateLabel }), _jsx("time", { dateTime: document.updatedAt, children: formatDate(document.updatedAt) })] })] });
}
function DocumentReader({ value, state, error, onBack, onRetry }) {
    const html = useMemo(() => value === undefined ? '' : renderMarkdown(readableMarkdown(value.content)), [value]);
    return _jsxs("div", { className: "dsh-knowledge-activity-reader", children: [_jsxs("div", { className: "dsh-knowledge-activity-reader-bar", children: [_jsxs("button", { type: "button", className: "dsh-knowledge-activity-back", onClick: onBack, children: [_jsx(IconChevronLeftOutline14, { size: 14 }), "\u6587\u6863\u76EE\u5F55"] }), value && _jsxs("span", { children: [formatDate(value.updatedAt), " \u66F4\u65B0"] })] }), state === 'loading' ? _jsx(ActivityState, { label: "\u6B63\u5728\u6253\u5F00\u6587\u6863\u2026" })
                : state === 'error' ? _jsx(ActivityError, { message: error, onRetry: onRetry })
                    : value === undefined ? _jsx(ActivityState, { label: "\u6B63\u5728\u51C6\u5907\u6587\u6863\u2026" })
                        : _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsh-knowledge-activity-document-heading", children: [_jsx("span", { className: "dsh-knowledge-activity-document-icon", children: _jsx(IconDataOutline16, { size: 18 }) }), _jsxs("div", { children: [_jsx("h2", { children: value.title }), _jsx("p", { children: value.relPath })] })] }), _jsx("article", { className: "dsh-knowledge-activity-markdown", dangerouslySetInnerHTML: { __html: html } })] })] });
}
function ActivityState({ label }) {
    return _jsxs("p", { className: "dsh-knowledge-activity-state", role: "status", children: [_jsx("span", { "aria-hidden": "true" }), label] });
}
function ActivityError({ message, onRetry }) {
    return _jsxs("div", { className: "dsh-knowledge-activity-error", role: "alert", children: [_jsx("strong", { children: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6" }), _jsx("p", { children: message }), _jsx("button", { type: "button", onClick: onRetry, children: "\u91CD\u8BD5" })] });
}
function ActivityEmpty({ title, description }) {
    return _jsxs("div", { className: "dsh-knowledge-activity-empty", children: [_jsx("span", { children: _jsx(IconDatabaseOutline16, { size: 20 }) }), _jsx("strong", { children: title }), _jsx("p", { children: description })] });
}
function readableMarkdown(value) {
    return value.replace(/^---\s*\n[\s\S]*?\n---\s*\n*/u, '').replace(/^#\s+[^\n]+\n*/u, '');
}
function shortId(value) {
    return value.length <= 12 ? value : `${value.slice(0, 7)}…${value.slice(-5)}`;
}
function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '未知时间';
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}
function message(reason) {
    return reason instanceof Error ? reason.message : String(reason);
}
//# sourceMappingURL=knowledge-activity-panel.js.map