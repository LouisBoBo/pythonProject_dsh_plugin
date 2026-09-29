const REBUILD_DELAY = 140;
const HEADING_SCROLL_INSET = 16;
export function calculateHeadingScrollTop(currentScrollTop, targetTop, scrollHostTop, maximumScrollTop, inset = HEADING_SCROLL_INSET) {
    const desiredTop = currentScrollTop + targetTop - scrollHostTop - inset;
    return Math.max(0, Math.min(desiredTop, Math.max(0, maximumScrollTop)));
}
function collectHeadings(editor) {
    const headings = [];
    editor.state.doc.descendants((node, position) => {
        if (node.type.name !== 'heading')
            return true;
        const text = node.textContent.trim();
        if (!text)
            return false;
        headings.push({
            level: Number(node.attrs.level) || 1,
            position,
            text: text.slice(0, 160),
            element: editor.view.nodeDOM(position),
        });
        return false;
    });
    return headings;
}
export function createNoteOutlineController(options) {
    const { editor, frame, host, scrollHost, toggleButton } = options;
    host.replaceChildren();
    const header = document.createElement('header');
    header.className = 'notes-editor-outline-header';
    const title = document.createElement('strong');
    title.textContent = '文档大纲';
    const count = document.createElement('span');
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'notes-editor-outline-close';
    closeButton.textContent = '关闭';
    closeButton.setAttribute('aria-label', '关闭文档大纲');
    header.append(title, count, closeButton);
    const list = document.createElement('nav');
    list.className = 'notes-editor-outline-list';
    list.setAttribute('aria-label', '笔记标题导航');
    host.append(header, list);
    let headings = [];
    let open = false;
    let manuallyToggled = false;
    let rebuildTimer;
    let observer;
    function syncOpenState() {
        frame.dataset.outlineOpen = String(open);
        host.setAttribute('aria-hidden', String(!open));
        host.inert = !open;
        toggleButton?.setAttribute('aria-pressed', String(open));
        toggleButton?.setAttribute('aria-expanded', String(open));
        if (open)
            observeHeadings();
        else
            observer?.disconnect();
    }
    function setActive(position) {
        for (const button of list.querySelectorAll('[data-heading-position]')) {
            const active = Number(button.dataset.headingPosition) === position;
            if (active)
                button.setAttribute('aria-current', 'location');
            else
                button.removeAttribute('aria-current');
        }
    }
    function jumpToHeading(item) {
        editor.commands.setTextSelection(item.position + 1);
        editor.view.dom.focus({ preventScroll: true });
        const target = item.element;
        if (target) {
            const scrollHostBounds = scrollHost.getBoundingClientRect();
            const targetBounds = target.getBoundingClientRect();
            const maximumScrollTop = scrollHost.scrollHeight - scrollHost.clientHeight;
            scrollHost.scrollTo({
                top: calculateHeadingScrollTop(scrollHost.scrollTop, targetBounds.top, scrollHostBounds.top, maximumScrollTop),
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            });
        }
        setActive(item.position);
        if (window.matchMedia('(max-width: 1120px), (hover: none) and (pointer: coarse) and (max-width: 1400px)').matches) {
            open = false;
            syncOpenState();
        }
    }
    function renderHeadings() {
        count.textContent = headings.length ? `${headings.length} 个标题` : '';
        list.replaceChildren();
        if (!headings.length) {
            const empty = document.createElement('p');
            empty.className = 'notes-editor-outline-empty';
            empty.textContent = '使用标题 1–3 后，会在这里生成可定位的大纲。';
            list.append(empty);
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const item of headings) {
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'notes-editor-outline-link';
            link.textContent = item.text;
            link.dataset.headingPosition = String(item.position);
            link.style.setProperty('--outline-depth', String(Math.max(0, Math.min(4, item.level - 1))));
            link.addEventListener('click', () => jumpToHeading(item));
            fragment.append(link);
        }
        list.append(fragment);
    }
    function observeHeadings() {
        observer?.disconnect();
        if (!open || !('IntersectionObserver' in window))
            return;
        observer = new IntersectionObserver(entries => {
            const visible = entries
                .filter(entry => entry.isIntersecting)
                .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
            const target = visible[0]?.target;
            const item = headings.find(heading => heading.element === target);
            if (item)
                setActive(item.position);
        }, {
            root: scrollHost,
            rootMargin: '-12px 0px -78% 0px',
            threshold: 0,
        });
        for (const item of headings)
            if (item.element)
                observer.observe(item.element);
    }
    function rebuild() {
        rebuildTimer = undefined;
        if (editor.isDestroyed)
            return;
        const next = collectHeadings(editor);
        const changed = next.length !== headings.length || next.some((item, index) => {
            const previous = headings[index];
            return !previous || previous.position !== item.position || previous.level !== item.level || previous.text !== item.text;
        });
        headings = next;
        if (changed)
            renderHeadings();
        if (!manuallyToggled && headings.length && !window.matchMedia('(max-width: 1120px), (hover: none) and (pointer: coarse) and (max-width: 1400px)').matches)
            open = true;
        if (!headings.length && !manuallyToggled)
            open = false;
        syncOpenState();
    }
    function scheduleRebuild() {
        if (rebuildTimer !== undefined)
            window.clearTimeout(rebuildTimer);
        rebuildTimer = window.setTimeout(rebuild, REBUILD_DELAY);
    }
    function toggle() {
        manuallyToggled = true;
        open = !open;
        syncOpenState();
    }
    function close() {
        manuallyToggled = true;
        open = false;
        syncOpenState();
    }
    closeButton.addEventListener('click', close);
    editor.on('update', scheduleRebuild);
    rebuild();
    return {
        toggle,
        close,
        destroy: () => {
            editor.off('update', scheduleRebuild);
            if (rebuildTimer !== undefined)
                window.clearTimeout(rebuildTimer);
            observer?.disconnect();
            host.replaceChildren();
            delete frame.dataset.outlineOpen;
        },
    };
}
//# sourceMappingURL=web-note-editor-outline.js.map