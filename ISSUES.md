| 发现时间 | 任务 | 严重度 | 描述 | 状态 |
|---------|------|--------|------|------|
| 2026-09-24 | T0 | 低 | 本机 npm 11.9.0 的 arborist 无法解析 `workspace:*` 协议（最小复现同样报错 EUNSUPPORTEDPROTOCOL）。已将 server/web 的 `@aiw/contracts` 依赖由 `workspace:*` 改为 `*`，npm 仍按工作区名称解析并软链本地包，行为等价。 | 已处理（偏离规格，已记录） |
| 2026-09-24 | T2 | 中 | 本环境 tsx 无法把 loader 传播进 `worker_threads`，导致 `.ts` worker 文件加载失败（"Unknown file extension .ts"）。已将 DB 进程由 `worker_threads` 改为 `child_process.fork` + `--import tsx` 启动子进程承载 better-sqlite3（仍不在主线程，符合规则 15 意图）。`RingBuffer.push` 改为 `push(seq, item)` 以便回填按序号过滤。 | 已处理（偏离规格，已记录） |
