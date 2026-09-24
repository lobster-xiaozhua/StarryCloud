import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.ts';
import { runs } from '../runs.ts';
import type { StoredMessage, TextPart, ToolCallPart } from '@aiw/contracts/messages';
import type { MessageDTO } from '@aiw/contracts/api';

export const messagesRouter = Router();

function toMessageDTO(m: StoredMessage): MessageDTO {
  const text = m.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const toolCall = m.parts.find((p): p is ToolCallPart => p.type === 'tool_call');
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: text,
    toolCall: toolCall
      ? { id: toolCall.id, name: toolCall.name, input: toolCall.input }
      : undefined,
    toolCallId: m.toolCallId,
    seq: m.seq,
    status: m.status,
    createdAt: m.createdAt,
  };
}

messagesRouter.get('/:id/messages', async (req, res) => {
  const list = await db.messages.listByConv(req.params.id!);
  res.json(list.map(toMessageDTO));
});

messagesRouter.post('/:id/messages', async (req, res) => {
  const convId = req.params.id!;
  const conv = await db.conversations.get(convId);
  if (!conv) return res.status(404).json({ error: 'conversation not found' });

  const content = req.body?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' });
  }

  // 会话正在运行 → 409（agent 接入后由 runs 标记）
  if (runs.has(convId)) {
    return res.status(409).json({ error: 'conversation is running' });
  }

  await db.messages.append({
    conversationId: convId,
    role: 'user',
    parts: [{ type: 'text', text: content }],
    status: 'complete',
  });

  const runId = randomUUID();
  res.status(201).json({ runId });
});
