export type SSEEvent =
  | { event: 'meta';       data: { seq: number; messageId: string } }
  | { event: 'delta';      data: { seq: number; content: string } }
  | { event: 'tool_start'; data: { seq: number; toolCallId: string; name: string; input: unknown } }
  | { event: 'tool_delta'; data: { seq: number; toolCallId: string; chunk: string } }
  | { event: 'tool_end';   data: { seq: number; toolCallId: string; output: import('./tools').ToolOutput } }
  | { event: 'done';       data: { seq: number; finishReason: 'stop' | 'aborted' | 'circuit' } }
  | { event: 'error';      data: { seq: number; message: string; code?: string } };

export const SSE_BUFFER_SIZE = 500;
