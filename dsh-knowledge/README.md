# @zhongruan/dsh-knowledge

中软知识库插件。基于上游 [`@lemoncat7/dsh-knowledge@2.9.6`](https://github.com/lemoncat7/dsh-knowledge)（MIT）整包 fork，**替换**市场里的 lemoncat7 包，不要两个同时装。

Cordis `id` 仍为 `knowledge`，本机数据仍走 `~/.dsh/.../knowledge/knowledge.sqlite`，已有库、挂载和文档可继续用。

## 和笔记的区别

| | 知识文档（导入走这里） | 笔记工作区 |
|---|---|---|
| 界面 | 「知识文档」「知识库与挂载」里的库/文档树 | 「笔记文档」 |
| 写入 | `POST /knowledge-local/v1/entries` | `POST …/notes/documents` 或 `…/notes/files` |
| 进 FTS / 挂载召回 | **是** | **否** |

「导入文件」只创建 **knowledge entry**，不会把 PDF/Markdown 丢进笔记区交差。

## 导入文件

1. 侧栏打开「知识库」。
2. 进入 **知识文档** 或某个库的详情（库须为可用，未归档）。
3. 点「导入文件」，可多选 `.md` / `.txt` / `.pdf` / `.docx`（大小写不敏感）。旧版 `.doc` 请另存为 `.docx`。其它扩展名会跳过并汇总失败原因。
4. 也可把文件拖到知识文档树；不要拖到笔记工作区。
5. 单文件不超过 16MB。抽出的正文超过 2MB 会失败；超过 50000 字会按标题/空行切成多篇，标题为 `原名`、`原名 (2)`。
6. PDF 只导入文字层；扫描件/图片版 PDF 会提示失败。Word 只抽正文，不保留复杂排版。
7. 导入后刷新文档树；把该库挂到会话（召回开）后，提问应能命中正文。

同名标题允许重复。默认 `type=fact`，标签 `imported`。

## 安装

公司插件走 **设置 → 插件市场 → 发现**。开发机：

```bash
# 先卸 lemoncat7，避免双开抢 id: knowledge
dsh plugin --profile web remove @lemoncat7/dsh-knowledge
dsh plugin --profile web add @zhongruan/dsh-knowledge@1.0.1
```

`package.json` 的 `dsh.client` 必须能解析到本包的 `client.js`。

## 默认配置

适配宿主 **dsh 0.1.1-rc.2**（该版本没有 `session.snapshotEvents()`，默认关闭轮后回写）。

```yaml
- id: knowledge
  name: '@zhongruan/dsh-knowledge'
  config:
    backend: local
    databasePath: !!js dshHomePath('knowledge/knowledge.sqlite')
    connectionPath: !!js dshHomePath('knowledge/connection.json')
    exposeApi: false
    exposeWeb: true
    extractionEnabled: false
```

用户 patch 若覆盖整块 `- id: knowledge`，**必须自带 `databasePath` 和 `connectionPath`**，否则启动即崩：`local knowledge backend requires databasePath`。

不要改 SQLite schema，除非做迁移。

## 开发

要求 Node.js `^22.19.0 || >=24.0.0`。交付物含上游 2.9.6 预构建 `lib/`；`web/` 为管理台源码。

```bash
cd dsh-knowledge
pnpm install
pnpm test
pnpm run build
pnpm pack --dry-run
```

上游能力（多库、挂载召回、笔记、远程模式等）见 [docs/architecture.md](docs/architecture.md) 与 [docs/requirements.md](docs/requirements.md)。历史发版说明仍是上游记录。

## 许可

MIT。Copyright (c) 2026 lemoncat7；中软改动同样按 MIT 分发。
