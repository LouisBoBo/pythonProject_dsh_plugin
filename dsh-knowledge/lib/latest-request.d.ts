/** One request owner per view: navigation, retry and pagination invalidate older work. */
export declare class LatestRequest {
    private current;
    start(): AbortSignal;
    cancel(): void;
}
//# sourceMappingURL=latest-request.d.ts.map