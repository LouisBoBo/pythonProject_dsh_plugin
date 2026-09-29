export interface KnowledgeServiceSettings {
    publicApiEnabled: boolean;
    writebackProvider?: string;
    writebackModel?: string;
}
export declare function serviceSettingsPath(connectionPath: string | undefined): string | undefined;
export declare function loadServiceSettings(path: string | undefined): KnowledgeServiceSettings | undefined;
export declare function storeServiceSettings(path: string, settings: KnowledgeServiceSettings): Promise<void>;
//# sourceMappingURL=service-settings.d.ts.map