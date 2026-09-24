import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { runAgent } from './loop.ts';
import { db } from '../db/client.ts';
import { bus } from '../sse/bus.ts';
import { runs } from '../runs.ts';
import type { Provider } from '../provider/types.ts';
import type { SSEEvent } from '@aiw/contracts/events';
import type { ToolOutput, ToolName, ToolSpec } from '@aiw/contracts/tools';

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; argsDelta: string }
  | { type: 'done'; finishReason: 'stop' | 'tool_calls' };

function providerFrom(rounds: StreamEvent[][]): Provider {
  let i = 0;
  return {
    async *stream() {
      const events = rounds[Math.min(i, rounds.length - 1)] ?? [];
      i += 1;
      for (const e of events) yield e;
    },
  };
}

// T13：abort 全链路。验证 POST /api/runs/:runId/abort 语义等价路径：
// runs.get 拿到 handle → abort.abort() → 主循环收束并以 done(aborted) 结束。
describe('agent abort 全链路', () => {
  it('abort 中断进行中的 run：SSE 以 done(aborted) 收尾，runs 句柄被清理', async () => {
    const conv = await db.conversations.create({ title: 't13-abort' });
    const runId = 'run-' + randomUUID();

    // 一个"慢工具"：等待 signal 触发，模拟长命令
    let toolStarted = false;
    const slowTool = {
      spec: { name: 'run_shell_command', description: 'slow', inputSchema: {} } as unknown as ToolSpec,
      run: async (_input: unknown, ctx: { signal: AbortSignal }): Promise<ToolOutput> => {
        toolStarted = true;
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) return resolve();
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          exitCode: null,
          stdout: '',
          stderr: 'killed',
          truncated: false,
          stdoutBytes: 0,
          durationMs: 1,
          aborted: true,
        };
      },
    };

    // 第一轮返回一个 tool_call，进入慢工具等待
    const provider = providerFrom([
      [
        { type: 'tool_call', id: 'c1', name: 'run_shell_command', argsDelta: JSON.stringify({ command: 'sleep 999' }) },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [{ type: 'text', text: '不应该走到这一轮' }, { type: 'done', finishReason: 'stop' }],
    ]);

    const got: SSEEvent[] = [];
    bus.subscribe(runId, 0, (ev) => got.push(ev));

    const registry = {
      run_shell_command: slowTool,
    } as unknown as Record<ToolName, { spec: ToolSpec; run: (i: unknown, c: { convId: string; signal: AbortSignal }) => Promise<ToolOutput> }>;

    const p = runAgent(conv.id, runId, '跑个长命令', { provider, toolRegistry: registry });

    // 等工具真正开始执行，再触发 abort（等价于 POST /abort → handle.abort.abort()）
    for (let i = 0; i < 200 && !toolStarted; i++) await new Promise((r) => setTimeout(r, 10));
    expect(toolStarted).toBe(true);

    const handle = runs.get(conv.id);
    expect(handle?.runId).toBe(runId);
    handle!.abort.abort();

    await p;

    // 句柄已清理（finally 中 runs.delete）
    expect(runs.get(conv.id)).toBeUndefined();

    // 事件流以 done(aborted) 收尾
    const done = got.filter((e) => e.event === 'done');
    expect(done.length).toBeGreaterThan(0);
    expect((done[done.length - 1]!.data as { finishReason: string }).finishReason).toBe('aborted');

    // SSE seq 连续
    const seqs = got.map((e) => e.data.seq);
    seqs.forEach((s, i) => expect(s).toBe(i + 1));

    // 工具结果落库且标记 aborted 语义（tool 消息存在）
    const msgs = await db.messages.listByConv(conv.id);
    expect(msgs.some((m) => m.role === 'tool')).toBe(true);
  });

  it('已结束的 run 不再持有句柄（abort 端点会返回 404 的依据）', async () => {
    const conv = await db.conversations.create({ title: 't13-done' });
    const runId = 'run-' + randomUUID();
    const provider = providerFrom([
      [{ type: 'text', text: '完成' }, { type: 'done', finishReason: 'stop' }],
    ]);
    await runAgent(conv.id, runId, '你好', { provider, toolRegistry: {} as never });
    expect(runs.get(conv.id)).toBeUndefined();
  });
});
