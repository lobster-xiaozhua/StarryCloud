import OpenAI from 'openai';
import type { ChatMessage, TextPart, ToolCallPart } from '@aiw/contracts/messages';
import type { ToolSpec } from '@aiw/contracts/tools';
import type { Provider } from './types.ts';

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    const textParts = m.parts.filter((p): p is TextPart => p.type === 'text');
    const text = textParts.map((p) => p.text).join('');

    if (m.role === 'system') {
      out.push({ role: 'system', content: text });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      const tcs = m.parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
      const toolCalls = tcs.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
      }));
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });
    } else {
      // role === 'tool'
      out.push({ role: 'tool', content: text, tool_call_id: m.toolCallId ?? '' });
    }
  }
  return out;
}

function toOpenAITools(tools: ToolSpec[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}

export function createOpenAIProvider(): Provider {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? 'missing',
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  });

  return {
    async *stream(req) {
      const completion = await client.chat.completions.create(
        {
          model: req.model,
          messages: toOpenAIMessages(req.messages),
          tools: req.tools.length ? toOpenAITools(req.tools) : undefined,
          stream: true,
        },
        { signal: req.signal },
      );

      const tcState = new Map<number, { id: string; name: string }>();
      let finish: string | null = null;

      for await (const chunk of completion) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta;
        if (!delta) continue;

        if (delta.content) {
          yield { type: 'text', text: delta.content };
        }

        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const st = tcState.get(idx) ?? { id: '', name: '' };
          if (tc.id) st.id = tc.id;
          if (tc.function?.name) st.name = tc.function.name;
          tcState.set(idx, st);
          const argsDelta = tc.function?.arguments ?? '';
          if (argsDelta) {
            yield { type: 'tool_call', id: st.id, name: st.name, argsDelta };
          }
        }
      }

      const finishReason =
        finish === 'tool_calls' ? 'tool_calls' : finish === 'length' ? 'length' : 'stop';
      yield { type: 'done', finishReason };
    },
  };
}

export const openaiProvider: Provider = createOpenAIProvider();
