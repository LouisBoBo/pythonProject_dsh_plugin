export interface SessionEvent {
    type?: string;
    data?: Record<string, unknown>;
}
export interface ProjectedMessage {
    body: string;
}
export interface ProjectedAssistant extends ProjectedMessage {
    step?: number;
}
export interface ProjectedTool {
    name: string;
    callId: string;
    arguments: string;
    result?: string;
}
export interface ProjectedTurn {
    users: ProjectedMessage[];
    assistants: ProjectedAssistant[];
    tools: ProjectedTool[];
    unpaired: {
        callId: string;
        body: string;
    }[];
}
export declare function isPositiveIntegerTurn(turn: unknown): turn is number;
export declare function safeSessionId(id: string): string | undefined;
/** 从最近一条同号 turn/start 切到下一条 turn/start 之前。找不到则返回 undefined。 */
export declare function sliceTurn(events: readonly SessionEvent[], turn: number): SessionEvent[] | undefined;
export declare function sessionTitleFromEvents(events: readonly SessionEvent[]): string;
export declare function projectTurn(events: readonly SessionEvent[], turn: number): ProjectedTurn | undefined;
export declare function turnHasContent(turn: ProjectedTurn): boolean;
export declare function clampUtf8(text: string, maxBytes: number): {
    text: string;
    truncated: boolean;
};
