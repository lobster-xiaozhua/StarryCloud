export interface CreateConversationReq { title?: string }
export interface CreateConversationRes { id: string; createdAt: number }
export interface SendMessageReq { content: string }
export interface SendMessageRes { runId: string }

export interface ConversationDTO {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  containerStatus?: 'running' | 'stopped' | 'missing';
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCall?: { id: string; name: string; input: unknown };
  toolCallId?: string;
  seq: number;
  status: 'complete' | 'streaming' | 'aborted';
  createdAt: number;
}
