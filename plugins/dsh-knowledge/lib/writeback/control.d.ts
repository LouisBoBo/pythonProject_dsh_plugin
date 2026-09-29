import type { RuntimeContextLike } from '../runtime.js';
import type { WritebackQueue } from './queue.js';
/** The outbox belongs to this DSH instance, never the remote knowledge provider. */
export declare function registerWritebackControl(ctx: RuntimeContextLike, queue: WritebackQueue | undefined): (() => void) | undefined;
//# sourceMappingURL=control.d.ts.map