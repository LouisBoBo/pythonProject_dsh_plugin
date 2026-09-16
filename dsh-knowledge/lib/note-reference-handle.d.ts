interface NoteHandlePayload {
    v: 1;
    sessionId: string;
    noteId: string;
}
/** Opaque, session-bound note handles keep AI mutations on searched results. */
export declare class KnowledgeNoteHandleCodec {
    private readonly secret;
    constructor(secret: Buffer);
    encode(sessionId: string, noteId: string): string;
    decode(handle: string, sessionId: string): NoteHandlePayload;
    private sign;
}
export {};
//# sourceMappingURL=note-reference-handle.d.ts.map