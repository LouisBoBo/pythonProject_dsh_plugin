/** 仅允许本插件生成的编号，防止 id 含 ../ 逃出草稿目录。 */
export declare function assertSafeReportId(id: string): string;
