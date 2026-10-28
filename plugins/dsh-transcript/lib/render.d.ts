import { type ProjectedTurn } from './events.js';
export declare const MAX_TRANSCRIPT_BYTES: number;
export interface TurnDocument {
    sessionTitle: string;
    sessionId: string;
    turn: number;
    writtenAt: string;
    projected: ProjectedTurn;
}
export declare function renderTurnDocument(doc: TurnDocument): string;
export declare function renderSessionCover(input: {
    title: string;
    sessionId: string;
    workspace?: string;
    updated: string;
    turns: string[];
}): string;
export interface IndexRow {
    title: string;
    sessionId: string;
    latestTurn: string;
    updated: string;
}
export declare function renderIndex(rows: readonly IndexRow[]): string;
export declare function readSessionCover(markdown: string): {
    title: string;
    updated: string;
};
export declare function finalizeTranscript(markdown: string): string;
