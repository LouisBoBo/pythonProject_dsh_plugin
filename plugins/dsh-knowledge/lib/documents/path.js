/** Stable, human-readable Markdown path shared by storage and retrieval output. */
export function knowledgeDocumentPath(entry) {
    const stem = entry.title.normalize('NFKC').trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, '-')
        .replace(/\s+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 72) || 'untitled';
    const suffix = entry.id.replace(/[^a-zA-Z0-9]/gu, '').slice(0, 8) || 'document';
    return `${stem}--${suffix}.md`;
}
//# sourceMappingURL=path.js.map