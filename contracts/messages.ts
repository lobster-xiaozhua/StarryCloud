export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart { type: 'text'; text: string }
export interface ToolCallPart {
  type: 'tool_call';
  id: string;
  name: string;
  input: unknown;
}
export type MessagePart = TextPart | ToolCallPart;

export interface ChatMessage {
  role: Role;
  parts: MessagePart[];
  toolCallId?: string;
}

export interface StoredMessage extends ChatMessage {
  id: string;
  conversationId: string;
  seq: number;
  status: 'complete' | 'streaming' | 'aborted';
  createdAt: number;
}
