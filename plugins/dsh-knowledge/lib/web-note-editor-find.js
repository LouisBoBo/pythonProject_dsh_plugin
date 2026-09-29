import { getNoteSearchState, replaceAllNoteSearchResults, replaceNoteSearchResult, updateNoteSearch, } from './web-note-editor-search.js';
function button(label, className, onClick) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = className;
    control.textContent = label;
    control.addEventListener('click', onClick);
    return control;
}
export function createNoteFindController(options) {
    const { editor, frame } = options;
    const panel = document.createElement('section');
    panel.className = 'notes-find-panel';
    panel.setAttribute('role', 'search');
    panel.setAttribute('aria-label', '在当前笔记中查找和替换');
    panel.hidden = true;
    const findRow = document.createElement('div');
    findRow.className = 'notes-find-row';
    const query = document.createElement('input');
    query.className = 'notes-find-input';
    query.type = 'search';
    query.placeholder = '查找当前笔记';
    query.setAttribute('aria-label', '查找当前笔记');
    query.autocomplete = 'off';
    query.spellcheck = false;
    const status = document.createElement('span');
    status.className = 'notes-find-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const previous = button('上一个', 'notes-find-button', () => move(-1));
    previous.setAttribute('aria-label', '上一个匹配项（Shift+Enter）');
    const next = button('下一个', 'notes-find-button', () => move(1));
    next.setAttribute('aria-label', '下一个匹配项（Enter）');
    const caseSensitive = button('Aa', 'notes-find-button notes-find-case', () => {
        const enabled = caseSensitive.getAttribute('aria-pressed') !== 'true';
        caseSensitive.setAttribute('aria-pressed', String(enabled));
        updateNoteSearch(editor, { query: query.value, caseSensitive: enabled, activeIndex: 0 });
        renderState(true);
    });
    caseSensitive.setAttribute('aria-label', '区分大小写');
    caseSensitive.setAttribute('aria-pressed', 'false');
    const replaceToggle = button('替换', 'notes-find-button', () => {
        const expanded = replaceToggle.getAttribute('aria-expanded') !== 'true';
        replaceToggle.setAttribute('aria-expanded', String(expanded));
        replaceRow.hidden = !expanded;
        if (expanded)
            replacement.focus();
    });
    replaceToggle.setAttribute('aria-controls', 'dsh-note-replace-row');
    replaceToggle.setAttribute('aria-expanded', 'false');
    const closeButton = button('关闭', 'notes-find-button notes-find-close', () => close({ restoreEditorFocus: true }));
    closeButton.setAttribute('aria-label', '关闭查找（Escape）');
    findRow.append(query, status, previous, next, caseSensitive, replaceToggle, closeButton);
    const replaceRow = document.createElement('div');
    replaceRow.id = 'dsh-note-replace-row';
    replaceRow.className = 'notes-replace-row';
    replaceRow.hidden = true;
    const replacement = document.createElement('input');
    replacement.className = 'notes-find-input';
    replacement.type = 'text';
    replacement.placeholder = '替换为';
    replacement.setAttribute('aria-label', '替换为');
    replacement.autocomplete = 'off';
    replacement.spellcheck = false;
    const replaceOne = button('替换当前', 'notes-find-button', replaceCurrent);
    const replaceAll = button('全部替换', 'notes-find-button', replaceEveryMatch);
    replaceRow.append(replacement, replaceOne, replaceAll);
    panel.append(findRow, replaceRow);
    frame.append(panel);
    let openState = false;
    let queryTimer;
    let scrollFrame;
    function selectedText() {
        const { from, to, empty } = editor.state.selection;
        if (empty || to - from > 256)
            return '';
        return editor.state.doc.textBetween(from, to, ' ').trim();
    }
    function syncQuery() {
        queryTimer = undefined;
        updateNoteSearch(editor, {
            query: query.value,
            caseSensitive: caseSensitive.getAttribute('aria-pressed') === 'true',
            activeIndex: 0,
        });
        renderState(true);
    }
    function scheduleQuery() {
        if (queryTimer !== undefined)
            window.clearTimeout(queryTimer);
        queryTimer = window.setTimeout(syncQuery, 90);
    }
    function commitPendingQuery() {
        const state = getNoteSearchState(editor);
        const pending = queryTimer !== undefined
            || state?.query !== query.value
            || state?.caseSensitive !== (caseSensitive.getAttribute('aria-pressed') === 'true');
        if (!pending)
            return false;
        if (queryTimer !== undefined)
            window.clearTimeout(queryTimer);
        syncQuery();
        return true;
    }
    function renderState(scroll) {
        const state = getNoteSearchState(editor);
        const total = state?.results.length ?? 0;
        const current = total ? (state?.activeIndex ?? 0) + 1 : 0;
        status.textContent = query.value ? (total ? `${current} / ${total}` : '未找到') : '';
        previous.disabled = total === 0;
        next.disabled = total === 0;
        replaceOne.disabled = total === 0;
        replaceAll.disabled = total === 0;
        if (scroll && total)
            scheduleScrollToCurrent();
    }
    function scheduleScrollToCurrent() {
        if (scrollFrame !== undefined)
            window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(() => {
            scrollFrame = undefined;
            frame.querySelector('.notes-search-result-current')?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'center',
            });
        });
    }
    function move(direction) {
        const state = getNoteSearchState(editor);
        const count = state?.results.length ?? 0;
        if (!state || count === 0)
            return;
        const activeIndex = (state.activeIndex + direction + count) % count;
        updateNoteSearch(editor, { activeIndex });
        renderState(true);
    }
    function replaceCurrent() {
        const state = getNoteSearchState(editor);
        const range = state?.results[state.activeIndex];
        if (!range)
            return;
        replaceNoteSearchResult(editor, range, replacement.value);
        renderState(true);
    }
    function replaceEveryMatch() {
        const state = getNoteSearchState(editor);
        if (!state?.results.length)
            return;
        replaceAllNoteSearchResults(editor, state.results, replacement.value);
        renderState(false);
    }
    function open() {
        if (editor.isDestroyed)
            return;
        openState = true;
        panel.hidden = false;
        frame.dataset.findOpen = 'true';
        options.onVisibilityChange?.(true);
        const selection = selectedText();
        if (selection)
            query.value = selection;
        updateNoteSearch(editor, {
            query: query.value,
            caseSensitive: caseSensitive.getAttribute('aria-pressed') === 'true',
            activeIndex: 0,
        });
        renderState(Boolean(query.value));
        window.requestAnimationFrame(() => { query.focus(); query.select(); });
    }
    function close(closeOptions = {}) {
        openState = false;
        panel.hidden = true;
        frame.dataset.findOpen = 'false';
        updateNoteSearch(editor, { query: '', activeIndex: 0 });
        options.onVisibilityChange?.(false);
        if (closeOptions.restoreEditorFocus)
            editor.commands.focus();
    }
    function onEditorTransaction() {
        if (openState)
            renderState(false);
    }
    function onQueryKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            close({ restoreEditorFocus: true });
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            if (!commitPendingQuery())
                move(event.shiftKey ? -1 : 1);
        }
    }
    query.addEventListener('input', scheduleQuery);
    query.addEventListener('keydown', onQueryKeyDown);
    replacement.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close({ restoreEditorFocus: true });
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey)
                replaceEveryMatch();
            else
                replaceCurrent();
        }
    });
    editor.on('transaction', onEditorTransaction);
    return {
        isOpen: () => openState,
        open,
        close,
        destroy: () => {
            editor.off('transaction', onEditorTransaction);
            if (queryTimer !== undefined)
                window.clearTimeout(queryTimer);
            if (scrollFrame !== undefined)
                window.cancelAnimationFrame(scrollFrame);
            updateNoteSearch(editor, { query: '', activeIndex: 0 });
            panel.remove();
        },
    };
}
//# sourceMappingURL=web-note-editor-find.js.map