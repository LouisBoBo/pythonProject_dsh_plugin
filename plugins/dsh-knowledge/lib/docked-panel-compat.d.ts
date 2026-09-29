import type { Context } from '@deepseek-ai/cordis';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
type PanelProps = PropsRuntime<'details'>;
/** The new host owns session persistence, docking and tab closure. */
export declare function supportsDockedPanels(ctx: Context): boolean;
export declare function createDockedPanel(ctx: Context, id: string, title: string, render: (props: PanelProps) => JSX.Element, notify: () => void): {
    open(sessionId: string): void;
    close(sessionId: string): void;
    isOpen(sessionId: string): boolean;
    dispose(): void;
};
export {};
//# sourceMappingURL=docked-panel-compat.d.ts.map