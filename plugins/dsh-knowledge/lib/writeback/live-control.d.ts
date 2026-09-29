import type { RuntimeContextLike } from '../runtime.js';
import type { WritebackQueue } from './queue.js';
/** Authenticated long polling: one notification channel per page, no job content. */
export declare function registerWritebackLive(ctx: RuntimeContextLike, queue?: WritebackQueue): (() => void) | undefined;
//# sourceMappingURL=live-control.d.ts.map