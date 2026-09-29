import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Keep host-version differences at the navigation boundary, not in pages. */
export declare function registerMainPanel(ctx: Context, id: string, priority: number, render: (props: PropsRuntime<'conversation'>) => JSX.Element, onHidden?: () => void): () => void;
//# sourceMappingURL=main-panel-compat.d.ts.map