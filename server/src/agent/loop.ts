import { db } from '../db/client.ts';
import { bus } from '../sse/bus.ts';
import { runs } from '../runs.ts';
import fs from 'node:fs';
import type { Provider } from '../provider/types.ts';
import { openaiProvider } from '../provider/openai.ts';
import { CIRCUIT } from './circuit.ts';
import { compressContext } from './context.ts';
import { tools, type ToolCtx } from './tools.ts';
import type { ToolName, ToolOutput, ToolSpec } from '@aiw/contracts/tools';
import type { ChatMessage, MessagePart } from '@aiw/contracts/messages';

const SYSTEM_PROMPT = fs.readFileSync(new URL('../prompts/system.md', import.meta.url), 'utf8');

const MODEL = process.env.MODEL ?? 'sensenova-6.8-flash-lite';

export interface AgentOpts {
  provider?: Provider;
  // 测试可注入 mock 工具；默认用真实注册表
  toolRegistry?: Record<ToolName, { spec: ToolSpec; run: (input: unknown, ctx: ToolCtx) => Promise<ToolOutput> }>;
}

// 规则 14：不把整段 stdout/stderr 直接塞进 messages；给模型的是有界、结构化的摘要
function toolResultText(out: ToolOutput): string {
  const lines: string[] = [];
  lines.push(`exit_code: ${out.exitCode === null ? 'null' : out.exitCode}`);
  if (out.aborted) lines.push('(aborted)');
  lines.push('stdout:');
  lines.push(out.stdout || '(empty)');
  if (out.stderr) {
    lines.push('stderr:');
    lines.push(out.stderr);
  }
  if (out.truncated) lines.push(`(output truncated; full log: ${out.note ?? 'n/a'})`);
  return lines.join('\n');
}

function estimateTokens(msgs: ChatMessage[]): number {
  let chars = 0;
  for (const m of msgs) {
    for (const p of m.parts) {
      if (p.type === 'text') chars += p.text.length;
      else if (p.type === 'tool_call') chars += JSON.stringify(p.input).length;
    }
  }
  return Math.ceil(chars / 4);
}

function hashInput(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export async function runAgent(
  convId: string,
  runId: string,
  userInput: string,
  opts: AgentOpts = {},
): Promise<void> {
  const provider = opts.provider ?? openaiProvider;
  const registry = opts.toolRegistry ?? tools;

  const abort = new AbortController();
  runs.set(convId, { runId, convId, abort });
  const startedAt = Date.now();

  let seq = 0;
  const nextSeq = (): number => ++seq;

  const publishDone = (finishReason: 'stop' | 'aborted' | 'circuit'): void => {
    bus.publish(runId, { event: 'done', data: { seq: nextSeq(), finishReason } });
  };

  try {
    const history = await db.messages.listByConv(convId);
    const compressed = compressContext(history);

    // 落库用户消息
    await db.messages.append({
      conversationId: convId,
      role: 'user',
      parts: [{ type: 'text', text: userInput }],
      status: 'complete',
    });

    const userChat: ChatMessage = {
      role: 'user',
      parts: [{ type: 'text', text: userInput }],
    };
    const systemMsg: ChatMessage = {
      role: 'system',
      parts: [{ type: 'text', text: SYSTEM_PROMPT }],
    };
    const messages: ChatMessage[] = [systemMsg, ...compressed, userChat];

    let toolCallCount = 0;
    let lastHash = '';
    let repeatCount = 0;

    for (let round = 0; ; round++) {
      if (abort.signal.aborted) {
        publishDone('aborted');
        return;
      }
      if (round >= CIRCUIT.maxRounds) {
        publishDone('circuit');
        return;
      }
      if (Date.now() - startedAt > CIRCUIT.maxWallClockMs) {
        publishDone('circuit');
        return;
      }
      if (toolCallCount >= CIRCUIT.maxToolCalls) {
        publishDone('circuit');
        return;
      }
      if (estimateTokens(messages) > CIRCUIT.maxTotalTokens) {
        publishDone('circuit');
        return;
      }

      const stream = provider.stream({
        messages,
        tools: Object.values(registry).map((t) => t.spec),
        signal: abort.signal,
        model: MODEL,
      });

      let assistantText = '';
      const toolCalls = new Map<string, { id: string; name: string; argsBuf: string }>();

      for await (const ev of stream) {
        if (ev.type === 'text') {
          assistantText += ev.text;
          bus.publish(runId, { event: 'delta', data: { seq: nextSeq(), content: ev.text } });
        } else if (ev.type === 'tool_call') {
          const st = toolCalls.get(ev.id) ?? { id: ev.id, name: ev.name, argsBuf: '' };
          if (ev.name) st.name = ev.name;
          st.argsBuf += ev.argsDelta;
          toolCalls.set(ev.id, st);
        }
      }

      if (abort.signal.aborted) {
        publishDone('aborted');
        return;
      }

      // 落库 assistant 消息（含工具调用）
      const assistantParts: MessagePart[] = [];
      if (assistantText) assistantParts.push({ type: 'text', text: assistantText });
      for (const tc of toolCalls.values()) {
        let input: unknown = {};
        if (tc.argsBuf) {
          try {
            input = JSON.parse(tc.argsBuf);
          } catch {
            input = tc.argsBuf;
          }
        }
        assistantParts.push({ type: 'tool_call', id: tc.id, name: tc.name, input });
      }
      const assistantMsg = await db.messages.append({
        conversationId: convId,
        role: 'assistant',
        parts: assistantParts,
        status: 'complete',
      });
      bus.publish(runId, { event: 'meta', data: { seq: nextSeq(), messageId: assistantMsg.id } });

      if (toolCalls.size === 0) {
        publishDone('stop');
        return;
      }

      // 串行执行工具（MVP 简化；v1.1 再考虑并行）
      for (const tc of toolCalls.values()) {
        if (abort.signal.aborted) {
          publishDone('aborted');
          return;
        }
        const toolName = tc.name as ToolName;
        let input: unknown = {};
        if (tc.argsBuf) {
          try {
            input = JSON.parse(tc.argsBuf);
          } catch {
            input = {};
          }
        }

        bus.publish(runId, {
          event: 'tool_start',
          data: { seq: nextSeq(), toolCallId: tc.id, name: toolName, input },
        });

        let out: ToolOutput;
        const fn = registry[toolName]?.run;
        if (!fn) {
          out = {
            exitCode: null,
            stdout: '',
            stderr: `未知工具: ${toolName}`,
            truncated: false,
            stdoutBytes: 0,
            durationMs: 0,
            aborted: false,
          };
        } else {
          try {
            out = await fn(input, { convId, signal: abort.signal });
          } catch (e) {
            out = {
              exitCode: null,
              stdout: '',
              stderr: e instanceof Error ? e.message : String(e),
              truncated: false,
              stdoutBytes: 0,
              durationMs: 0,
              aborted: abort.signal.aborted,
            };
          }
        }

        bus.publish(runId, {
          event: 'tool_end',
          data: { seq: nextSeq(), toolCallId: tc.id, output: out },
        });

        const toolText = toolResultText(out);
        await db.messages.append({
          conversationId: convId,
          role: 'tool',
          parts: [{ type: 'text', text: toolText }],
          toolCallId: tc.id,
          status: 'complete',
        });
        messages.push({
          role: 'tool',
          parts: [{ type: 'text', text: toolText }],
          toolCallId: tc.id,
        });

        toolCallCount++;
        const hash = `${toolName}:${hashInput(input)}`;
        if (hash === lastHash) repeatCount++;
        else {
          repeatCount = 1;
          lastHash = hash;
        }
        if (repeatCount >= CIRCUIT.maxRepeatSameTool) {
          publishDone('circuit');
          return;
        }
      }
    }
  } finally {
    runs.delete(convId);
  }
}
