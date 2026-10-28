# @zhongruan/dsh-transcript

每一轮主聊天结束时，把这一轮已经落在 DSH 会话里的内容写成家目录下的 Markdown。聊天本身仍以 DSH 会话为准。归档失败只记日志，不打断对话。

## 目录

默认根目录是宿主家目录下的 `transcripts/`（`dshHomePath('transcripts')`）。

```text
transcripts/
  index.md
  <sessionId>/
    会话.md
    001/对话.md
```

目录名用会话 id 和轮次号。标题写在 `会话.md` 和 `index.md`。

## 询问路径

对话里可以调用只读工具 `zr_transcript_where`。它只返回路径，不触发保存。

## 配置

`enabled: false` 时不注册监听，也不注册工具。没有密钥，没有业务连接。
