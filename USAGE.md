# AI 工作台 · 使用说明（USAGE）

单用户本地 AI Agent 工作台：在浏览器里和模型对话，模型可以在**隔离的 Linux 容器**里执行命令、读写文件，完成 CSV 处理、批量重命名、数据分析这类活儿。

---

## 1. 前置要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | 20 LTS（≥ 20.18） | 本仓库用 22 也能跑 |
| npm | ≥ 10 | 使用 npm workspaces |
| Docker | ≥ 24（已在 27.5.1 验证） | 需 daemon 在运行；容器管理走 CLI，不依赖 dockerode |

一个 **OpenAI 兼容**的模型服务（本仓库用 SenseNova 网关验证过）：

```
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://token.sensenova.cn/v1
MODEL=sensenova-6.8-flash-lite
```

---

## 2. 首次部署（4 步）

```bash
# 1) 安装依赖（根目录一次装齐三个 workspace）
npm install

# 2) 构建沙箱镜像 —— 必需，否则工具调用会因缺镜像而失败
docker build -f Dockerfile.sandbox -t aiw-sandbox:latest .

# 3) 配置模型凭据
cp .env.example .env   # 若无该文件则手动创建 .env
# 编辑 .env 填入 OPENAI_API_KEY / OPENAI_BASE_URL / MODEL

# 4) 启动（后端 :3000 + 前端 Vite :5173）
npm run dev
```

> **重要**：`.env` 已被 `.gitignore` 忽略，密钥不会进仓库。

浏览器打开 **http://localhost:5173** 即可使用。（Vite 已把 `/api` 代理到 `:3000`。）

### 验证是否就绪

```bash
npm run check          # 三个包 tsc 全绿
npm run test:all       # 全部测试
```

容器类测试默认在**缺镜像时打印提示并跳过**；想强制真跑：

```bash
cd server && AIW_REQUIRE_DOCKER=1 npx vitest run
```

---

## 3. 日常使用

1. 左侧点 **「+ 新对话」**。
2. 在底部输入框描述任务，回车发送。例如：
   - `帮我在 /workspace 创建 data.csv，写入 10 行数字，然后用 awk 算平均值`
   - `看一下当前目录有哪些文件`
   - `把 /workspace 里所有 .txt 批量改名为 .md`
3. 助手回复流式出现；当它调用工具时，会插入一个**工具过程块**：
   - 标题栏显示 `🔧 工具名 · 参数`，右侧是结果徽章（`exit 0` / `exit 1` / `运行中…` / `已中断`）
   - 点标题栏可展开/收起，展开后看到 `exit_code` 与 `stdout`
4. 想中止，点 **「停止」**。中断是**全链路**的：服务端触发 AbortSignal → 容器内命令进程组被清理 → 该轮以 `done(aborted)` 收尾。

### 每条对话一个容器

| 项 | 值 |
|----|----|
| 容器名 | `aiw-conv-<conversationId>` |
| 挂载 | 宿主机 `data/workspaces/<conversationId>` ↔ 容器 `/workspace` |
| 用户 | 非 root（`sandbox`，uid 1000） |
| 网络 | **默认关闭**（`--network=none`） |
| 资源 | 4G 内存 / 4 核 / `pids-limit 512` / 只读根文件系统 |
| 生命周期 | **重启后 `/workspace` 文件保留，其余全丢**（装过的 pip/npm 包也会丢） |

> 容器是按会话复用的：同一会话内多次工具调用共享同一个容器和 `/workspace`，所以「先写文件、再执行命令」这种多步任务是连贯的。

---

## 4. 可用工具

模型能调用三个工具，全部被限制在 `/workspace` 内：

| 工具 | 作用 | 关键约束 |
|------|------|----------|
| `run_shell_command` | 在容器内跑 shell 命令 | 默认超时 300s；输出超 8KB 时头 60% + 尾 40% 截断，完整日志落 `/tmp/aiw-out-*.log` |
| `read_file` | 读取 `/workspace` 下的文件 | 路径必须位于 `/workspace` 前缀内，否则拒绝 |
| `write_file` | 写入 `/workspace` 下的文件 | 同上；内容经 base64 传输，避免转义问题 |

---

## 5. 三件必须知道的机制

### 上下文压缩
长对话不会把全部历史塞给模型：**最近 6 轮全量**保留，更早轮次的工具结果被压成一行摘要（`[已执行 xxx，退出码 0，输出 N 行]`），单条工具输出上限 8KB；估算 token 超窗口 60% 时，对最早 3 轮做一次性摘要。数据库里始终保留**完整**记录，压缩只作用于送模型的那份。

### 熔断保护
主循环有五重上限，命中即停并返回 `done(circuit)`：最大轮次、最长墙钟时间、token 预算、工具调用总数、同一工具重复调用次数。

### 启动恢复
进程崩溃/被杀会留下 `status='streaming'` 的半截消息。**下次启动时会被直接删除**（不是改状态）——因为残缺的 `tool_call` 没有配对的 `tool_result`，留着会让模型请求 400。启动日志会打印 `[server] cleaned N stale messages`。

---

## 6. 常用命令

```bash
npm run dev            # 后端 + 前端一起起
npm run check          # 三个包 tsc --noEmit
npm run test:all       # 全部测试
npm run test:db        # DB 子进程
npm run test:provider  # Provider 流式
npm run test:container # 容器 ensure/stop/inspect
npm run test:exec      # 容器内执行（超时/截断/ANSI）
npm run test:tools     # 工具注册表校验
npm run test:agent     # agent 主循环
npm run test:sse       # SSE bus + ring
```

### 冒烟脚本

```bash
npx tsx scripts/smoke-provider.ts   # 直连模型，打印流式输出
npx tsx scripts/cp2-e2e.ts          # 全栈 HTTP→SSE
npx tsx scripts/cp3-smoke.ts        # 容器内真实执行
npx tsx scripts/t15-fixture.ts      # 塞入一条 streaming 残留
npx tsx scripts/t15-verify.ts       # 验证启动清理是否生效
```

---

## 7. 排障

| 现象 | 原因 / 处理 |
|------|-------------|
| 工具块显示 `exit 127` | 容器内没有该命令。`aiw-sandbox` 自带 `bash / coreutils / python3 / node20`；如果用的是精简基础镜像，换成 `Dockerfile.sandbox` 构建的镜像 |
| 工具调用报「容器不存在」 | 镜像没构建。执行 `docker build -f Dockerfile.sandbox -t aiw-sandbox:latest .` |
| 测试输出 `[SKIP] aiw-sandbox:latest not found` | 正常自跳过。要强制真跑：`AIW_REQUIRE_DOCKER=1 npx vitest run` |
| 发送后助手没反应 | 检查 `.env` 的模型凭据与网络；看后端日志 |
| 想清空所有数据 | 删除 `data/` 目录（含 SQLite 与各会话 workspace） |

---

## 8. 安全边界

- 容器**默认无网络**，不会自行外联。
- 非 root 运行、根文件系统只读、内存/CPU/进程数受限。
- 文件工具强制 `/workspace` 前缀校验，无法读写宿主机其他路径。
- 系统提示词中明确禁止 `rm -rf /`、`dd`、`mkfs` 等破坏性命令，并要求删除前先 `ls` 确认。

> 这是**单用户本地**工作台，没有多用户隔离与鉴权，请勿直接暴露到公网。
