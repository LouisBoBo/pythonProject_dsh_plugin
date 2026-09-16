/**
 * Preserve input order while bounding independent asynchronous work. This is
 * primarily used for mounted remote knowledge bases, where an unbounded
 * Promise.all would otherwise turn one tool call into hundreds of requests.
 */
export async function mapConcurrent(items, concurrency, operation) {
    if (items.length === 0)
        return [];
    const workerCount = Math.min(items.length, Math.max(1, Math.trunc(concurrency)));
    const results = new Array(items.length);
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await operation(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}
//# sourceMappingURL=async-pool.js.map