| ID | 名称                      | 状态 | 完成日期 | commit | 备注 |
|----|---------------------------|------|----------|--------|------|
| T0 | 契约冻结                  | ✅ 完成 | 2026-09-24 | 49f514a | git tag contracts-v1 |
| T1 | Provider + 第一行流式输出 | ✅ 完成 | 2026-09-24 | 533a3b7 | 代码+tsc通过；T1 smoke 已用 SenseNova 跑通（流式输出+finishReason=stop）|
| T2 | DB worker + 迁移          | ✅ 完成 | 2026-09-24 | 5c254e3 | child_process.fork 替代 worker_threads（环境限制，见 ISSUES）；test:db 5/5 通过 |
| T3 | SSE bus + ring            | ✅ 完成 | 2026-09-24 | 2d8ace9 | test:sse 5/5 通过 |
| T4 | REST 路由                 | ✅ 完成 | 2026-09-24 | f212634 | createApp + 4 路由；SSE 端点三件套+Last-Event-ID 已验证（路由集成测试 3/3）|
| T5 | 前端最小聊天              | ✅ 完成 | 2026-09-24 | 6748076 | web tsc clean + vite build PASS；EventSource 订阅 run 流；scripts/cp2-e2e.ts 已写（全栈 HTTP→SSE 自测 PASS）|
| T6 | 沙箱镜像                  | ✅ 完成 | 2026-09-24 | 5ffe80e | Dockerfile.sandbox；**偏移规格 +1 处：补 util-linux/procps，见 ISSUES.md（fixed in T6-amend）**；沙箱内 apt/nodejs.org 不可达，build 无法实跑 |
| T7 | container/cli + manager   | ✅ 完成 | 2026-09-24 | b30a7aa | cli.ts/manager.ts/manager.test.ts；镜像缺失时打印 [SKIP] 自跳过（沙箱），tsc=0 · tag t7-done |
| T8 | container/exec            | ✅ 完成 | 2026-09-24 | 0543cd1 | exec.ts/exec.test.ts；超时/abort 改 Node 侧（setsid 丢退出码，见 ISSUES）；+AIW_REQUIRE_DOCKER 强制真跑；修复 O(N²) 输出累积（37.3s→0.35s，见 ISSUES P1）· tag t8-done |
| T9 | 工具注册表                | ✅ 完成 | 2026-09-24 | 3f010ee | tools.ts/tools.test.ts；zod 校验 + /workspace 前缀强制 + base64 写；校验用例实跑 10/10 · tag t9-done |
| T10 | agent/loop + circuit     | ✅ 完成 | 2026-09-24 | e8830db | loop.ts/circuit.ts + 压缩占位 context.ts；mock provider/工具测试 2/2 通过；全服务 37 测试绿 · tag t10-done |
| T11 | 系统提示词                | ✅ 完成 | 2026-09-24 | e3b6106 | prompts/system.md 已写并接入 loop.ts（system 消息前置）· tag t11-done |
| T12 | 前端工具过程展示          | ✅ 完成 | 2026-09-24 | 4017f1c | ToolBlock.tsx + ChatStream 补丁 + app.tsx 事件接线 + style.css；**修复 P0：SSE 负载解析错层（见 ISSUES）**；Chromium 真实驱动验收通过 |
| T13 | abort 全链路              | ✅ 完成 | 2026-09-24 | - | POST /api/runs/:runId/abort → handle.abort.abort() → provider/exec signal 联动；abort.test 2/2 + HTTP 实测通过 |
| T14 | 上下文压缩                | ⬜ 未开始 | - | - | - |
| T15 | 启动恢复                  | ⬜ 未开始 | - | - | - |
