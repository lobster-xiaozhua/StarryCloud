/**
 * T12 验收专用：注册一个「驱动 agent SSE 事件」的测试端点，
 * 让浏览器可以真实走「点击发送 → 连接 run 流 → 渲染工具块」的完整前端路径，
 * 而不需要外部 LLM。仅在 T12 验收脚本中挂载，不进入生产路由。
 */
import { setTimeout as sleep } from 'node:timers/promises';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { bus } from '../server/src/sse/bus.ts';
import { db } from '../server/src/db/client.ts';

export function registerFrontendRoutes(app: Express): void {
  app.post('/api/__t12/run', async (req, res) => {
    const convId = String(req.body?.conversationId ?? '');
    const conv = await db.conversations.get(convId);
    if (!conv) return res.status(404).json({ error: 'conversation not found' });

    const runId = randomUUID();
    res.status(201).json({ runId });
    void drive(runId, convId, String(req.body?.content ?? ''));
  });
}

async function drive(runId: string, convId: string, userText: string): Promise<void> {
  await db.messages.append({
    conversationId: convId,
    role: 'user',
    parts: [{ type: 'text', text: userText }],
    status: 'complete',
  });

  let seq = 0;
  const pub = (event: string, data: Record<string, unknown>): void => {
    seq += 1;
    bus.publish(runId, { event, data: { seq, ...data } } as never);
  };

  pub('delta', { content: '好的，我来统计行数。' });
  await sleep(250);
  pub('tool_start', {
    toolCallId: 'call_1',
    name: 'run_shell_command',
    input: { command: 'wc -l data.csv' },
  });
  await sleep(250);
  pub('tool_delta', { toolCallId: 'call_1', chunk: '10 data.csv\n' });
  await sleep(250);
  // 与真实跑通的 T8 输出同形（@aiw/contracts/events 的 tool_end.data.output = ToolOutput）
  pub('tool_end', {
    toolCallId: 'call_1',
    output: {
      exitCode: 0,
      stdout: '10 data.csv\n',
      stderr: '',
      truncated: false,
      stdoutBytes: 11,
      durationMs: 42,
      aborted: false,
      note: undefined,
    },
  });
  await sleep(250);
  pub('delta', { content: 'data.csv 共有 10 行。' });
  await sleep(250);
  pub('done', { finishReason: 'stop' });
}
