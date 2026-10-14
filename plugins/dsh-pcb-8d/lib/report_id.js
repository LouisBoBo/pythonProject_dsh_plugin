/** 仅允许本插件生成的编号，防止 id 含 ../ 逃出草稿目录。 */
export function assertSafeReportId(id) {
    const key = String(id || '').trim();
    if (!/^8D-\d{8}-\d{4}-[a-f0-9]{4}$/i.test(key)) {
        throw new Error(`非法报告编号「${id}」`);
    }
    return key;
}
