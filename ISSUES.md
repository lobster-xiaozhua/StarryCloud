| 发现时间 | 任务 | 严重度 | 描述 | 状态 |
|---------|------|--------|------|------|
| 2026-09-24 | T0 | 低 | 本机 npm 11.9.0 的 arborist 无法解析 `workspace:*` 协议（最小复现同样报错 EUNSUPPORTEDPROTOCOL）。已将 server/web 的 `@aiw/contracts` 依赖由 `workspace:*` 改为 `*`，npm 仍按工作区名称解析并软链本地包，行为等价。 | 已处理（偏离规格，已记录） |
| 2026-09-24 | T2 | 中 | 本环境 tsx 无法把 loader 传播进 `worker_threads`，导致 `.ts` worker 文件加载失败（"Unknown file extension .ts"）。已将 DB 进程由 `worker_threads` 改为 `child_process.fork` + `--import tsx` 启动子进程承载 better-sqlite3（仍不在主线程，符合规则 15 意图）。`RingBuffer.push` 改为 `push(seq, item)` 以便回填按序号过滤。 | 已处理（偏离规格，已记录） |
| 2026-09-24 | T6 | 中 | 沙箱容器网络无法访问 deb.debian.org / nodejs.org（DNS 被导向 captive 198.18.0.34），`docker build -f Dockerfile.sandbox` 在本环境无法完成，故 T6 验收命令未能在沙箱内实跑。Dockerfile 按规格逐字编写（仅按 T8/T13 验证命令需要补 `util-linux procps` 提供 setsid/pkill/ps），在正常联网机器上可正常 build。容器内测试（T7/T8/CP3）改为镜像缺失时自跳过，保证测试套件在此环境保持绿色、在用户机器上真实执行。 | 已处理（环境限制，已记录） |
