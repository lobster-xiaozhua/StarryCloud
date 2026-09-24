import type { ChatMessage } from '@aiw/contracts/messages';
import type { ToolSpec } from '@aiw/contracts/tools';

export interface Provider {
  stream(req: {
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
    model: string;
  }): AsyncIterable<
    | { type: 'text'; text: string }
    | { type: 'tool_call'; id: string; name: string; argsDelta: string }
    | { type: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' }
  >;
}
