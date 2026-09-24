/**
 * T12 浏览器验收：真实 server（静态托管 web/dist）+ 注入 tool_* 事件流，
 * 用 Chromium 打开页面、进入会话、订阅 SSE，断言「工具过程块」被渲染。
 *
 * 注意：createApp() 末尾挂了 404 兜底，静态托管必须插在它之前，
 * 因此这里自建 express 应用并复用各路由，而非直接 createApp()。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { conversationsRouter } from '../server/src/routes/conversations.ts';
import { messagesRouter } from '../server/src/routes/messages.ts';
import { runsRouter } from '../server/src/routes/runs.ts';
import { settingsRouter } from '../server/src/routes/settings.ts';
import { bus } from '../server/src/sse/bus.ts';
import { db } from '../server/src/db/client.ts';
import { registerFrontendRoutes } from './t12-fixture-routes.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3012;
const RUN_ID = 't12-browser-run';

async function main(): Promise<void> {
  const conv = await db.conversations.create({ title: 'T12 渲染验收' });

  const app = express();
  app.use(express.json());
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/conversations', messagesRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/settings', settingsRouter);
  registerFrontendRoutes(app);
  // 静态前端放在 API 之后、404 兜底之前
  app.use(express.static(path.join(__dirname, '..', 'web', 'dist')));
  const server = app.listen(PORT);

  let seq = 0;
  const pub = (event: string, data: Record<string, unknown>): void => {
    seq += 1;
    bus.publish(RUN_ID, { event, data: { seq, ...data } } as never);
  };

  // 先注入，保证 EventSource 一连上就能回放到完整过程块
  pub('delta', { content: '好的，我来统计行数。' });
  pub('tool_start', {
    toolCallId: 'call_1',
    name: 'run_shell_command',
    input: { command: 'wc -l data.csv' },
  });
  pub('tool_delta', { toolCallId: 'call_1', chunk: '10 data.csv\n' });
  pub('tool_end', {
    toolCallId: 'call_1',
    exitCode: 0,
    aborted: false,
    output: 'exit_code: 0\nstdout:\n10 data.csv\n',
  });
  pub('done', { finishReason: 'stop' });

  console.log(`[t12-browser] serving on http://localhost:${PORT}`);
  console.log(`[t12-browser] conv=${conv.id} run=${RUN_ID}`);

  fs.writeFileSync(
    '/tmp/t12-fixture-info.json',
    JSON.stringify({ port: PORT, convId: conv.id, runId: RUN_ID }),
  );

  void server;
  await new Promise<void>(() => undefined);
}

void main();
