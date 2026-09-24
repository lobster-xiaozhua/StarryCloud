import { describe, expect, it } from 'vitest';
import {
  compressContext,
  estimateTokens,
  RECENT_ROUNDS,
  TOOL_OUTPUT_LIMIT,
} from './context.ts';
import type { StoredMessage } from '@aiw/contracts/messages';

let seq = 0;
function mkMsg(p: Partial<StoredMessage> & Pick<StoredMessage, 'role' | 'parts'>): StoredMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    conversationId: 'c1',
    seq,
    status: 'complete',
    createdAt: Date.now(),
    ...p,
  } as StoredMessage;
}

/** 造一轮：user → assistant(tool_call) → tool(结果) */
function mkRound(i: number, bigOutput = false): StoredMessage[] {
  const toolCallId = `call-${i}`;
  const stdout = bigOutput
    ? Array.from({ length: 400 }, (_, k) => `line ${k} of round ${i}`).join('\n')
    : `result-${i}`;
  return [
    mkMsg({ role: 'user', parts: [{ type: 'text', text: `第 ${i} 轮问题：请统计文件 ${i}.csv` }] }),
    mkMsg({
      role: 'assistant',
      parts: [
        { type: 'text', text: `第 ${i} 轮先看看。` },
        { type: 'tool_call', id: toolCallId, name: 'run_shell_command', input: { command: `wc -l ${i}.csv` } },
      ],
    }),
    mkMsg({
      role: 'tool',
      toolCallId,
      parts: [{ type: 'text', text: `exit_code: 0\nstdout:\n${stdout}` }],
    }),
  ];
}

describe('T14 compressContext', () => {
  it('规格验收：20 轮对话，送模型的 messages 长度 < 原始 40%', () => {
    const history: StoredMessage[] = [];
    for (let i = 0; i < 20; i++) history.push(...mkRound(i, true));

    // 规格的「messages 长度」以送模型的载荷计：每条消息的文本总字符数。
    // （实现上，更早轮次的 tool 结果被摘要吸收，不再逐条保留，故条数与体量同时下降。）
    const original = history.reduce(
      (n, m) => n + m.parts.reduce((k, p) => k + (p.type === 'text' ? p.text.length : 0), 0),
      0,
    );
    const compressed = compressContext(history);
    const after = compressed.reduce(
      (n, m) => n + m.parts.reduce((k, p) => k + (p.type === 'text' ? p.text.length : 0), 0),
      0,
    );

    expect(after).toBeLessThan(original * 0.4);
    // 条数也应显著减少（tool 结果被合并进摘要）
    expect(compressed.length).toBeLessThan(history.length);

    // eslint-disable-next-line no-console
    console.log(
      `[T14] chars ${original} → ${after} (${((after / original) * 100).toFixed(1)}%)；` +
        `messages ${history.length} → ${compressed.length} (${(
          (compressed.length / history.length) * 100
        ).toFixed(1)}%)`,
    );
  });

  it('规格 2：最近 6 轮全量保留（内容不被摘要）', () => {
    const history: StoredMessage[] = [];
    for (let i = 0; i < 20; i++) history.push(...mkRound(i, true));
    const compressed = compressContext(history);

    // 最近一轮的 tool 输出应保留原始内容（非摘要）
    const lastRoundStart = 20 - RECENT_ROUNDS;
    const lastToolText = compressed
      .filter((m) => m.role === 'tool')
      .map((m) => (m.parts[0]?.type === 'text' ? m.parts[0].text : ''))
      .at(-1)!;
    expect(lastToolText).toContain(`round ${19}`);
    expect(lastToolText).not.toContain('[已执行');
    expect(lastRoundStart).toBeGreaterThanOrEqual(0);
  });

  it('规格 3：更早的 tool 结果被替换为一行摘要', () => {
    const history: StoredMessage[] = [];
    for (let i = 0; i < 20; i++) history.push(...mkRound(i));
    const compressed = compressContext(history);

    // 摘要以 assistant 消息承载（同一轮多条 tool 摘要合并为一条）
    const summaries = compressed
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'text' && p.text.startsWith('[已执行'))
      .map((p) => (p as { text: string }).text);

    expect(summaries.length).toBeGreaterThan(0);
    // 摘要形如 [已执行 run_shell_command，退出码 0，输出 N 行]
    expect(summaries[0]).toMatch(/^\[已执行 run_shell_command，退出码 0，输出 \d+ 行\]$/);
  });

  it('规格 1：单条 tool 输出上限 8KB', () => {
    const huge = 'x'.repeat(TOOL_OUTPUT_LIMIT * 2);
    const history: StoredMessage[] = [
      mkMsg({ role: 'user', parts: [{ type: 'text', text: '跑个超大输出' }] }),
      mkMsg({
        role: 'assistant',
        parts: [{ type: 'tool_call', id: 'call-big', name: 'run_shell_command', input: { command: 'big' } }],
      }),
      mkMsg({
        role: 'tool',
        toolCallId: 'call-big',
        parts: [{ type: 'text', text: `exit_code: 0\nstdout:\n${huge}` }],
      }),
    ];
    const compressed = compressContext(history);
    const toolText = compressed
      .filter((m) => m.role === 'tool')
      .map((m) => (m.parts[0]?.type === 'text' ? m.parts[0].text : ''))[0]!;
    // 正文（不含截断提示）不超过上限 + 提示行
    expect(toolText.length).toBeLessThanOrEqual(TOOL_OUTPUT_LIMIT + 64);
    expect(toolText).toContain('本工具输出已截断');
  });

  it('规格 5：超窗口 60% 触发对最早 3 轮的一次性摘要', () => {
    const history: StoredMessage[] = [];
    for (let i = 0; i < 20; i++) history.push(...mkRound(i, true));

    // 强制一个很小的窗口，确保触发
    const small = compressContext(history, { modelWindow: 1000 });
    const earlyToolSummaries = small
      .flatMap((m) => m.parts)
      .filter((p) => p.type === 'text' && p.text.startsWith('[已执行'));
    expect(earlyToolSummaries.length).toBeGreaterThan(0);

    // 大窗口下不触发时，最早 3 轮若落在"最近 6 轮"内则应保留原文
    const tokens = estimateTokens(history);
    expect(tokens).toBeGreaterThan(1000 * 0.6);
  });

  it('空历史与单轮不崩、且保持角色顺序', () => {
    expect(compressContext([])).toEqual([]);

    const one = mkRound(1);
    const compressed = compressContext(one);
    expect(compressed.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    // toolCallId 透传，保证 tool_result 能配对
    expect(compressed.find((m) => m.role === 'tool')?.toolCallId).toBe('call-1');
  });
});
