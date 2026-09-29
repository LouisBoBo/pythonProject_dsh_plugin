import { type ReactNode } from 'react';
import type { KnowledgeActivityController } from './knowledge-activity-controller.js';
/** Expand the requested host column once, then reveal our reader with a transform.
 * Avoid reflowing the conversation on every opening frame. No host styles or
 * transition settings are changed; only the in-flight column transition finishes.
 * Closing retains a stable reader width until the host releases the column.
 */
export declare function KnowledgeActivityPresentation({ controller, sessionId, onClosed, children }: {
    controller: KnowledgeActivityController;
    sessionId: string;
    onClosed(): void;
    children: ReactNode;
}): JSX.Element;
//# sourceMappingURL=knowledge-activity-presentation.d.ts.map