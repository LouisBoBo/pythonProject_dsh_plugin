import Schema from '@deepseek-ai/schemastery';
export interface TranscriptConfig {
    enabled?: boolean;
    archiveRoot?: string;
}
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    archiveRoot: Schema<string, string, "plain">;
}>>, Schemastery.ObjectT<NoInfer<{
    enabled: Schema<boolean, boolean, "defined">;
    archiveRoot: Schema<string, string, "plain">;
}>>, "plain">;
export declare function dshHome(): string;
/** 绝对路径按宿主注入值使用。相对路径落在 DSH 家目录下，避免写进当前工程。 */
export declare function resolveConfig(config: TranscriptConfig | undefined): {
    enabled: boolean;
    archiveRoot: string;
};
