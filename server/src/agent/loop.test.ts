import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client.ts';
import { bus } from '../sse/bus.ts';
import { runAgent } from './loop.ts';
import type { Provider } from '../provider/types.ts';
import type { ToolName, ToolOutput, ToolSpec } from '@aiw/contracts/tools';
import type { SSEEvent } from '@aiw/contracts/events';

const DATA_DIR = path.join(os.tmpdir(), 'aiw-agent-' + randomUUID());
process.env.DATA_DIR = DATA_DIR;

type RunFn = (input: unknown, ctx: { convId: string; signal: AbortSignal }) => Promise<ToolOutput>;

type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; argsDelta: string }
  | { type: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' };

function fixedProvider(events: StreamEvent[]): Provider {
  return {
    async *stream() {
      for (const e of events) yield e;
    },
  };
}

const dummySpec: ToolSpec = { name: 'run_shell_command', description: 'x', parameters: {} };

const fixedOutput: ToolOutput = {
  exitCode: 0,
  stdout: 'hi',
  stderr: '',
  truncated: false,
  stdoutBytes: 2,
  durationMs: 1,
};

describe('agent/loop', () => {
  let convId: string;

  beforeAll(async () => {
    const conv = await db.conversations.create({ title: 'loop-test' });
    convId = conv.id;
  });

  afterAll(async () => {
    await db.close().catch(() => undefined);
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('mock provider 返回固定 tool_call → 消息落库顺序正确 + SSE seq 连续 + done stop', async () => {
    const runId = 'run-' + randomUUID();
    // 第 1 轮给工具调用，第 2 轮只回文本（模拟真实 provider 看到工具结果后收尾）
    let calls = 0;
    const provider: Provider = {
      async *stream() {
        calls++;
        if (calls === 1) {
          yield { type: 'text', text: '好的，我来执行。' };
          yield { type: 'tool_call', id: 'c1', name: 'run_shell_command', argsDelta: JSON.stringify({ command: 'echo hi' }) };
          yield { type: 'done', finishReason: 'tool_calls' };
        } else {
          yield { type: 'text', text: '已执行完成。' };
          yield { type: 'done', finishReason: 'stop' };
        }
      },
    };
    const registry: Record<ToolName, { spec: ToolSpec; run: RunFn }> = {
      run_shell_command: { spec: dummySpec, run: async () => fixedOutput },
      read_file: { spec: dummySpec, run: async () => fixedOutput },
      write_file: { spec: dummySpec, run: async () => fixedOutput },
    };

    const seqs: number[] = [];
    const got: SSEEvent[] = [];
    const unsub = bus.subscribe(runId, 0, (ev: SSEEvent) => {
      seqs.push(ev.data.seq);
      got.push(ev);
    });

    await runAgent(convId, runId, '请执行 echo hi', { provider, toolRegistry: registry });
    unsub();

    // SSE seq 连续
    expect(seqs.length).toBeGreaterThan(0);
    seqs.forEach((s, i) => expect(s).toBe(i + 1));

    // 消息落库顺序：user / assistant(含 tool_call) / tool(结果)
    const msgs = await db.messages.listByConv(convId);
    const roles = msgs.map((m) => m.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');

    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant?.parts.some((p) => p.type === 'tool_call' && p.name === 'run_shell_command')).toBe(true);

    const toolMsg = msgs.find((m) => m.role === 'tool');
    expect(toolMsg?.toolCallId).toBe('c1');
    expect(toolMsg?.parts[0]?.type === 'text' ? toolMsg.parts[0].text : '').toContain('exit_code: 0');

    // 最后一个事件是 done stop
    const last = got.at(-1);
    expect(last?.event).toBe('done');
    expect((last?.data as { finishReason: string }).finishReason).toBe('stop');
  });

  it('连续相同工具调用触发熔断 → done { finishReason: circuit }', async () => {
    const runId = 'run-' + randomUUID();
    const loopEvents: StreamEvent[] = [
      { type: 'tool_call', id: 'loop1', name: 'run_shell_command', argsDelta: JSON.stringify({ command: 'repeat' }) },
      { type: 'done', finishReason: 'tool_calls' },
    ];
    const provider = fixedProvider(loopEvents);
    const registry: Record<ToolName, { spec: ToolSpec; run: RunFn }> = {
      run_shell_command: { spec: dummySpec, run: async () => fixedOutput },
      read_file: { spec: dummySpec, run: async () => fixedOutput },
      write_file: { spec: dummySpec, run: async () => fixedOutput },
    };

    const finishes: string[] = [];
    const unsub = bus.subscribe(runId, 0, (ev: SSEEvent) => {
      if (ev.event === 'done') finishes.push((ev.data as { finishReason: string }).finishReason);
    });

    await runAgent(convId, runId, '一直重复', { provider, toolRegistry: registry });
    unsub();

    expect(finishes).toContain('circuit');
  });
});
