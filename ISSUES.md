| 发现时间 | 任务 | 严重度 | 描述 | 状态 |
|---------|------|--------|------|------|
| 2026-09-24 | T0 | 低 | 本机 npm 11.9.0 的 arborist 无法解析 `workspace:*` 协议（最小复现同样报错 EUNSUPPORTEDPROTOCOL）。已将 server/web 的 `@aiw/contracts` 依赖由 `workspace:*` 改为 `*`，npm 仍按工作区名称解析并软链本地包，行为等价。 | 已处理（偏离规格，已记录） |
