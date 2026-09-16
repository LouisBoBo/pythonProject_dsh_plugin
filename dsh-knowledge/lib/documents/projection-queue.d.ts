/**
 * Serialize Markdown projection work for one managed document root.
 *
 * A local DSH process may hold separate provider instances for the active
 * agent connection and the management API. They share SQLite and the same
 * document directory, so filesystem reconciliation must be ordered across
 * instances rather than only within one provider object.
 */
export declare function enqueueDocumentProjection<T>(root: string, operation: () => Promise<T>): Promise<T>;
//# sourceMappingURL=projection-queue.d.ts.map