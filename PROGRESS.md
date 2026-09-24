| ID | 名称                      | 状态 | 完成日期 | commit | 备注 |
|----|---------------------------|------|----------|--------|------|
| T0 | 契约冻结                  | ✅ 完成 | 2026-09-24 | 49f514a | git tag contracts-v1 |
| T1 | Provider + 第一行流式输出 | ✅ 完成 | 2026-09-24 | 533a3b7 | 代码+tsc通过；T1 smoke 已用 SenseNova 跑通（流式输出+finishReason=stop）|
| T2 | DB worker + 迁移          | ✅ 完成 | 2026-09-24 | 5c254e3 | child_process.fork 替代 worker_threads（环境限制，见 ISSUES）；test:db 5/5 通过 |
| T3 | SSE bus + ring            | ✅ 完成 | 2026-09-24 | 2d8ace9 | test:sse 5/5 通过 |
| T4 | REST 路由                 | ✅ 完成 | 2026-09-24 | f212634 | createApp + 4 路由；SSE 端点三件套+Last-Event-ID 已验证（路由集成测试 3/3）|
| T5 | 前端最小聊天              | ✅ 完成 | 2026-09-24 | - | web tsc clean + vite build PASS；EventSource 订阅 run 流；scripts/cp2-e2e.ts 已写（全栈 HTTP→SSE 自测 PASS）|
| T6 | 沙箱镜像                  | ⬜ 未开始 | - | - | - |
| T7 | container/cli + manager   | ⬜ 未开始 | - | - | - |
| T8 | container/exec            | ⬜ 未开始 | - | - | - |
| T9 | 工具注册表                | ⬜ 未开始 | - | - | - |
| T10 | agent/loop + circuit     | ⬜ 未开始 | - | - | - |
| T11 | 系统提示词                | ⬜ 未开始 | - | - | - |
| T12 | 前端工具过程展示          | ⬜ 未开始 | - | - | - |
| T13 | abort 全链路              | ⬜ 未开始 | - | - | - |
| T14 | 上下文压缩                | ⬜ 未开始 | - | - | - |
| T15 | 启动恢复                  | ⬜ 未开始 | - | - | - |
