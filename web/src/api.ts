import type {
  ConversationDTO,
  MessageDTO,
  SendMessageRes,
} from '@aiw/contracts/api';

const BASE = '/api';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function listConversations(): Promise<ConversationDTO[]> {
  return json<ConversationDTO[]>(await fetch(`${BASE}/conversations`));
}

export async function createConversation(
  title?: string,
): Promise<ConversationDTO> {
  const res = await fetch(`${BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  const data = await json<{ id: string; createdAt: number }>(res);
  return {
    id: data.id,
    title: title ?? '新对话',
    createdAt: data.createdAt,
    updatedAt: data.createdAt,
  };
}

export async function listMessages(convId: string): Promise<MessageDTO[]> {
  return json<MessageDTO[]>(
    await fetch(`${BASE}/conversations/${convId}/messages`),
  );
}

export async function sendMessage(
  convId: string,
  content: string,
): Promise<string> {
  const res = await fetch(`${BASE}/conversations/${convId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  const data = await json<SendMessageRes>(res);
  return data.runId;
}

// T13：中断进行中的 run（服务端触发 AbortSignal，最终以 done(aborted) 收尾）
export async function abortRun(runId: string): Promise<void> {
  await fetch(`${BASE}/runs/${runId}/abort`, { method: 'POST' });
}
