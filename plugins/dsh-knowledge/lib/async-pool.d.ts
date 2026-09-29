/**
 * Preserve input order while bounding independent asynchronous work. This is
 * primarily used for mounted remote knowledge bases, where an unbounded
 * Promise.all would otherwise turn one tool call into hundreds of requests.
 */
export declare function mapConcurrent<T, R>(items: readonly T[], concurrency: number, operation: (item: T, index: number) => Promise<R>): Promise<R[]>;
//# sourceMappingURL=async-pool.d.ts.map