import type { ChatMessage, StoredMessage, TextPart, ToolCallPart } from '@aiw/contracts/messages';

// ── T14 上下文压缩 ────────────────────────────────────────────────
// 策略（按规格 5 条）：
//  1. 单条 tool 输出上限 8KB
//  2. 最近 6 轮全量保留
//  3. 更早的 tool 结果替换为一行摘要：[已执行 {name}，退出码 {code}，输出 {n} 行]
//  4. 展示层用全量（DB 不动），送模型用压缩版（本函数输出）
//  5. 触发式：估算 token 超过窗口 60% 时，对最早 3 轮做一次性摘要

/** 单条 tool 输出的字符上限（8KB） */
export const TOOL_OUTPUT_LIMIT = 8 * 1024;
/** 全量保留的最近轮数 */
export const RECENT_ROUNDS = 6;
/** 触发式摘要的阈值：估算 token 占上下文窗口比例 */
export const TRIGGER_RATIO = 0.6;
/** 模型上下文窗口（token） */
export const CONTEXT_WINDOW = 32_000;
/** 触发式摘要时，对最早多少轮做一次性摘要 */
export const DIGEST_EARLIEST_ROUNDS = 3;

const SUMMARY_MARK = '[已执行';

function isToolMsg(m: StoredMessage): boolean {
  return m.role === 'tool';
}

/** 把一条 message 的 text 部分拼起来 */
function textOf(m: StoredMessage): string {
  return m.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

/** 估算 token：按 4 字符 ≈ 1 token */
export function estimateTokens(msgs: readonly { parts: readonly (TextPart | ToolCallPart)[] }[]): number {
  let chars = 0;
  for (const m of msgs) {
    for (const p of m.parts) {
      if (p.type === 'text') chars += p.text.length;
      else if (p.type === 'tool_call') chars += JSON.stringify(p.input).length + p.name.length;
    }
  }
  return Math.ceil(chars / 4);
}

/** 规格 1：单条 tool 输出截断到 8KB */
function capToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_LIMIT) return text;
  const omitted = text.length - TOOL_OUTPUT_LIMIT;
  return `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n…[本工具输出已截断，省略 ${omitted} 字符]`;
}

/**
 * 规格 3：把一条 tool 消息压成一行摘要。
 * 形如： [已执行 run_shell_command，退出码 0，输出 12 行]
 */
function summarizeTool(m: StoredMessage, toolNameById: Map<string, string>): string {
  const text = textOf(m);
  const name = (m.toolCallId && toolNameById.get(m.toolCallId)) || 'tool';
  const codeMatch = /exit_code:\s*(-?\d+|null)/.exec(text);
  const code = codeMatch?.[1] ?? '?';
  const bodyStart = text.indexOf('stdout:');
  const body = bodyStart >= 0 ? text.slice(bodyStart + 'stdout:'.length) : text;
  const lines = body.split('\n').filter((l) => l.trim() !== '').length;
  return `${SUMMARY_MARK} ${name}，退出码 ${code}，输出 ${lines} 行]`;
}

/** 建 toolCallId → 工具名 的索引（来自 assistant 的 tool_call 部分） */
function buildToolNameIndex(history: readonly StoredMessage[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const m of history) {
    for (const p of m.parts) {
      if (p.type === 'tool_call') idx.set(p.id, p.name);
    }
  }
  return idx;
}

/**
 * 把 StoredMessage 序列按“轮”切分。
 * 一轮 = 一条 user 消息，直到下一条 user 消息之前（含其间的 assistant/tool）。
 */
function splitRounds(history: readonly StoredMessage[]): StoredMessage[][] {
  const rounds: StoredMessage[][] = [];
  let cur: StoredMessage[] | null = null;
  for (const m of history) {
    if (m.role === 'user' || cur === null) {
      cur = [];
      rounds.push(cur);
    }
    cur.push(m);
  }
  return rounds;
}

function toChat(m: StoredMessage, parts: ChatMessage['parts']): ChatMessage {
  return {
    role: m.role,
    parts,
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
  };
}

/**
 * 压缩上下文（规格 T14）。
 *
 * @param history DB 中的完整消息（展示层用全量，本函数不改 DB）
 * @param opts.modelWindow 可选：覆盖上下文窗口（测试用）
 */
export function compressContext(
  history: readonly StoredMessage[],
  opts: { modelWindow?: number } = {},
): ChatMessage[] {
  if (history.length === 0) return [];

  const window = opts.modelWindow ?? CONTEXT_WINDOW;
  const toolNameById = buildToolNameIndex(history);
  const rounds = splitRounds(history);

  // 规格 5：估算 token 超窗口 60% → 对最早 3 轮做一次性摘要
  const overBudget = estimateTokens(history) > window * TRIGGER_RATIO;

  // 需要“摘要”的最早 N 轮（触发式下一次摘要最早 DIGEST_EARLIEST_ROUNDS 轮；
  // 未触发时，超出“最近 RECENT_ROUNDS 轮”的更早轮次也要按规格 3 摘要化）
  const keepFrom = Math.max(0, rounds.length - RECENT_ROUNDS);

  const out: ChatMessage[] = [];

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i]!;
    const isRecent = i >= keepFrom;

    if (isRecent && !(overBudget && i < DIGEST_EARLIEST_ROUNDS)) {
      // 规格 1 + 2：最近若干轮全量保留（tool 输出仍受 8KB 上限约束）
      for (const m of round) {
        const parts = isToolMsg(m)
          ? [{ type: 'text' as const, text: capToolOutput(textOf(m)) }]
          : m.parts;
        out.push(toChat(m, parts));
      }
      continue;
    }

    // 更早的轮次（或触发式需摘要的最早几轮）：
    // 整轮坍缩为【一条 user 提问 + 一条摘要】。
    // 关键点：带 tool_call 的 assistant 消息必须一并去掉 —— 它引用的 tool_call
    // 已无对应 tool_result（已被摘要吸收），留着会让 OpenAI 协议 400。
    const toolSummaries: string[] = [];
    let userText = '';
    for (const m of round) {
      if (isToolMsg(m)) toolSummaries.push(summarizeTool(m, toolNameById));
      else if (m.role === 'user') userText += textOf(m);
    }
    if (userText) {
      out.push({ role: 'user', parts: [{ type: 'text', text: userText }] });
    }
    if (toolSummaries.length > 0) {
      out.push({
        role: 'assistant',
        parts: [{ type: 'text', text: toolSummaries.join('\n') }],
      });
    }
  }

  return out;
}
