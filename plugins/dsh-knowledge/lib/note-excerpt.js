/** Plain selected text must not introduce Markdown/HTML or a second link. */
export function noteExcerptMarkdown(noteId, text) {
    if (!/^note_[a-f0-9]{32}$/.test(noteId))
        throw new Error('无效的来源笔记');
    return text.trim().split(/\r?\n/).map(line => line.trim()
        ? `[${line.replace(/[\\`*_[\]<>!#|~]/g, '\\$&')}](note://${noteId})`
        : '').join('\n\n');
}
//# sourceMappingURL=note-excerpt.js.map