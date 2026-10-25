# @zhongruan/dsh-key-quota

按 DeepSeek Key 统计工作助手里的 token。人认平台账号，Key 由 admin 分配。

- 领导用平台账号 admin 登录，在 Key 管理里把 Key 指定给同事，看各 Key 用量并设上限。
- 同事用自己的平台账号登录，只用分给自己的那把 Key，也只看自己的用量。
- 用量和上限记在平台上。同一个平台账号换一台电脑，看到的是同一份。
- 尚未分配 Key 时，该同事的模型调用不发出。
- token 合计与 `@zhongruan/dsh-llm-meter` 相同：reasoning 不进合计。本插件不改那本账。

方案见 `docs/10-token用量统计/按Key限额-可行性实施方案.md`。登录哪个平台账号，对话就用分给该账号的那把 Key，用量记在这一把上。系统配置里的 Key 可以留空。页面只显示尾号。
