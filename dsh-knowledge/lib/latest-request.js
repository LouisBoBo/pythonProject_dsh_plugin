/** One request owner per view: navigation, retry and pagination invalidate older work. */
export class LatestRequest {
    current;
    start() {
        this.cancel();
        this.current = new AbortController();
        return this.current.signal;
    }
    cancel() {
        this.current?.abort();
        this.current = undefined;
    }
}
//# sourceMappingURL=latest-request.js.map