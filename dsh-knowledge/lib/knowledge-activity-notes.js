import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { IconChevronLeftOutline14, IconChevronRightOutline14, IconCloseOutline16, IconDataOutline16, IconFolderOpenOutline16, IconRefreshOutline14, IconSearchOutline16, } from '@deepseek-ai/dsh-client-ui-primitives';
import { loadNoteContent, loadNoteIndex } from './knowledge-activity-api.js';
import { LatestRequest } from './latest-request.js';
import { renderMarkdown } from './web-markdown-preview.js';
export function KnowledgeActivityNotes({ sessionId, projectId, controller }) {
    const initial = controller.selection(sessionId);
    const [folderId, setFolderId] = useState(initial.noteFolderId ?? null);
    const [crumbs, setCrumbs] = useState(initial.noteCrumbs ?? [{ id: null, name: '全部笔记' }]);
    const [selectedId, setSelectedId] = useState(initial.noteDocumentId);
    const [nodes, setNodes] = useState([]);
    const [content, setContent] = useState();
    const [queryInput, setQueryInput] = useState('');
    const [query, setQuery] = useState('');
    const [listState, setListState] = useState('loading');
    const [contentState, setContentState] = useState('idle');
    const [error, setError] = useState('');
    const listRequest = useRef(new LatestRequest());
    const [refresh, setRefresh] = useState(0);
    const loadNodes = useCallback(async () => {
        const signal = listRequest.current.start();
        setListState('loading');
        setError('');
        try {
            const value = await loadNoteIndex({
                sessionId,
                ...projectId === undefined ? {} : { projectId },
                parentId: folderId,
                query,
                ...signal === undefined ? {} : { signal },
            });
            if (signal.aborted)
                return;
            setNodes(value);
            setListState('ready');
        }
        catch (reason) {
            if (signal?.aborted)
                return;
            setListState('error');
            setError(message(reason));
        }
    }, [folderId, projectId, query, sessionId]);
    useEffect(() => {
        void loadNodes();
        return () => { listRequest.current.cancel(); };
    }, [loadNodes, refresh]);
    useEffect(() => {
        if (selectedId === undefined) {
            setContent(undefined);
            setContentState('idle');
            return;
        }
        const abort = new AbortController();
        setContentState('loading');
        setError('');
        void loadNoteContent({
            id: selectedId,
            sessionId,
            ...projectId === undefined ? {} : { projectId },
            signal: abort.signal,
        }).then(value => {
            if (abort.signal.aborted)
                return;
            setContent(value);
            setContentState('ready');
        }).catch(reason => {
            if (abort.signal.aborted)
                return;
            setContentState('error');
            setError(message(reason));
        });
        return () => { abort.abort(); };
    }, [projectId, refresh, selectedId, sessionId]);
    const openFolder = (node) => {
        setFolderId(node.id);
        const nextCrumbs = [...crumbs, { id: node.id, name: node.name }];
        setCrumbs(nextCrumbs);
        setQuery('');
        setQueryInput('');
        controller.select(sessionId, { mode: 'notes', noteFolderId: node.id, noteDocumentId: undefined, noteCrumbs: nextCrumbs });
    };
    const openCrumb = (crumb, index) => {
        setFolderId(crumb.id);
        const nextCrumbs = crumbs.slice(0, index + 1);
        setCrumbs(nextCrumbs);
        setSelectedId(undefined);
        controller.select(sessionId, { mode: 'notes', noteFolderId: crumb.id, noteDocumentId: undefined, noteCrumbs: nextCrumbs });
    };
    const openNode = (node) => {
        if (node.kind === 'folder')
            return openFolder(node);
        if (!node.editable)
            return;
        setSelectedId(node.id);
        controller.select(sessionId, { ...controller.selection(sessionId), mode: 'notes', noteFolderId: folderId, noteDocumentId: node.id });
    };
    const closeDocument = () => {
        setSelectedId(undefined);
        setContent(undefined);
        controller.select(sessionId, { ...controller.selection(sessionId), mode: 'notes', noteFolderId: folderId, noteDocumentId: undefined });
    };
    const submitSearch = (event) => {
        event.preventDefault();
        setSelectedId(undefined);
        setContent(undefined);
        controller.select(sessionId, { noteDocumentId: undefined });
        setQuery(queryInput.trim());
    };
    if (selectedId !== undefined)
        return _jsx(NoteReader, { value: content, state: contentState, error: error, onBack: closeDocument, onRetry: () => setRefresh(value => value + 1) });
    return _jsxs("div", { className: "dsh-knowledge-activity-browser", children: [_jsxs("form", { className: "dsh-knowledge-activity-search", role: "search", onSubmit: submitSearch, children: [_jsx(IconSearchOutline16, { size: 16, "aria-hidden": "true" }), _jsx("input", { "aria-label": "\u641C\u7D22\u7B14\u8BB0\u6587\u6863", value: queryInput, placeholder: "\u641C\u7D22\u7B14\u8BB0\u548C\u76EE\u5F55\u2026", onChange: event => setQueryInput(event.target.value) }), queryInput && _jsx("button", { type: "button", onClick: () => { setQueryInput(''); setQuery(''); }, "aria-label": "\u6E05\u9664\u641C\u7D22", children: _jsx(IconCloseOutline16, { size: 14 }) })] }), !query && _jsx("nav", { className: "dsh-knowledge-activity-breadcrumbs", "aria-label": "\u7B14\u8BB0\u76EE\u5F55\u8DEF\u5F84", children: crumbs.map((crumb, index) => _jsxs("span", { children: [index > 0 && _jsx(IconChevronRightOutline14, { size: 12 }), _jsx("button", { type: "button", "aria-current": index === crumbs.length - 1 ? 'location' : undefined, onClick: () => openCrumb(crumb, index), children: crumb.name })] }, `${crumb.id ?? 'root'}-${index}`)) }), _jsxs("div", { className: "dsh-knowledge-activity-list-heading", children: [_jsxs("span", { children: [_jsx("strong", { children: query ? `“${query}” 的结果` : crumbs.at(-1)?.name ?? '笔记文档' }), _jsx("small", { children: query ? '搜索全部笔记' : `当前显示 ${nodes.length} 项` })] }), _jsx("button", { type: "button", className: "dsh-knowledge-activity-icon-button", "aria-label": "\u5237\u65B0\u7B14\u8BB0", title: "\u5237\u65B0", onClick: () => setRefresh(value => value + 1), children: _jsx(IconRefreshOutline14, { size: 14 }) })] }), _jsx("div", { className: "dsh-knowledge-activity-list", "aria-busy": listState === 'loading', children: listState === 'loading' && nodes.length === 0 ? _jsx(ActivityState, { label: "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\u2026" })
                    : listState === 'error' ? _jsx(ActivityError, { error: error, onRetry: () => setRefresh(value => value + 1) })
                        : nodes.length === 0 ? _jsx(ActivityEmpty, { query: query })
                            : nodes.map(node => _jsxs("button", { type: "button", className: "dsh-knowledge-activity-row", disabled: node.kind !== 'folder' && !node.editable, onClick: () => openNode(node), children: [_jsx("span", { className: "dsh-knowledge-activity-row-icon", children: node.kind === 'folder' ? _jsx(IconFolderOpenOutline16, { size: 16 }) : _jsx(IconDataOutline16, { size: 16 }) }), _jsxs("span", { className: "dsh-knowledge-activity-row-copy", children: [_jsx("strong", { children: node.name }), _jsx("small", { children: node.kind === 'folder' ? '目录' : node.editable ? formatSize(node.size) : '暂不支持侧栏预览' })] }), _jsxs("span", { className: "dsh-knowledge-activity-row-meta", children: [_jsx("time", { dateTime: node.updatedAt, children: formatDate(node.updatedAt) }), node.kind === 'folder' && _jsx(IconChevronRightOutline14, { size: 13 })] })] }, node.id)) })] });
}
function NoteReader({ value, state, error, onBack, onRetry }) {
    const html = useMemo(() => value === undefined ? '' : renderMarkdown(value.content), [value]);
    return _jsxs("div", { className: "dsh-knowledge-activity-reader", children: [_jsxs("div", { className: "dsh-knowledge-activity-reader-bar", children: [_jsxs("button", { type: "button", className: "dsh-knowledge-activity-back", onClick: onBack, children: [_jsx(IconChevronLeftOutline14, { size: 14 }), "\u7B14\u8BB0\u76EE\u5F55"] }), value && _jsxs("span", { children: [formatDate(value.node.updatedAt), " \u66F4\u65B0"] })] }), state === 'loading' ? _jsx(ActivityState, { label: "\u6B63\u5728\u6253\u5F00\u7B14\u8BB0\u2026" })
                : state === 'error' ? _jsx(ActivityError, { error: error, onRetry: onRetry })
                    : value === undefined ? _jsx(ActivityState, { label: "\u6B63\u5728\u51C6\u5907\u7B14\u8BB0\u2026" })
                        : _jsxs(_Fragment, { children: [_jsxs("div", { className: "dsh-knowledge-activity-document-heading", children: [_jsx("span", { className: "dsh-knowledge-activity-document-icon", children: _jsx(IconDataOutline16, { size: 18 }) }), _jsxs("div", { children: [_jsx("h2", { children: value.node.name }), _jsxs("p", { children: ["\u7B14\u8BB0\u6587\u6863 \u00B7 ", formatSize(value.node.size)] })] })] }), _jsx("article", { className: "dsh-knowledge-activity-markdown", dangerouslySetInnerHTML: { __html: html } })] })] });
}
function ActivityState({ label }) {
    return _jsxs("p", { className: "dsh-knowledge-activity-state", role: "status", children: [_jsx("span", { "aria-hidden": "true" }), label] });
}
function ActivityError({ error, onRetry }) {
    return _jsxs("div", { className: "dsh-knowledge-activity-error", role: "alert", children: [_jsx("strong", { children: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6" }), _jsx("p", { children: error }), _jsx("button", { type: "button", onClick: onRetry, children: "\u91CD\u8BD5" })] });
}
function ActivityEmpty({ query }) {
    return _jsxs("div", { className: "dsh-knowledge-activity-empty", children: [_jsx("span", { children: _jsx(IconDataOutline16, { size: 20 }) }), _jsx("strong", { children: query ? '没有找到相关笔记' : '这个目录还是空的' }), _jsx("p", { children: query ? '换个关键词，或清除搜索后浏览目录。' : '可以在完整工作区中新建或导入笔记。' })] });
}
function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return '未知时间';
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date);
}
function formatSize(value) {
    if (value < 1024)
        return `${value} B`;
    if (value < 1024 * 1024)
        return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
function message(reason) {
    return reason instanceof Error ? reason.message : String(reason);
}
//# sourceMappingURL=knowledge-activity-notes.js.map