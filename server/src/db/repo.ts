import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { ConversationDTO } from '@aiw/contracts/api';
import type {
  StoredMessage,
  MessagePart,
  TextPart,
  ToolCallPart,
} from '@aiw/contracts/messages';

export function runMigrations(db: Database.Database): void {
  const version = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (version < 1) {
    const sql = fs.readFileSync(
      new URL('./migrations/001_init.sql', import.meta.url),
      'utf8',
    );
    db.exec(sql);
    db.pragma('user_version = 1');
  }
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_call_json: string | null;
  seq: number;
  status: string;
  created_at: number;
}

function serializeParts(parts: MessagePart[]): {
  content: string;
  toolCallJson: string | null;
} {
  const text = parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
  const calls = parts.filter((p): p is ToolCallPart => p.type === 'tool_call');
  return {
    content: text,
    toolCallJson: calls.length ? JSON.stringify(calls) : null,
  };
}

function deserializeMessage(row: MessageRow): StoredMessage {
  const parts: MessagePart[] = [];
  if (row.content) parts.push({ type: 'text', text: row.content });
  if (row.tool_call_json) {
    const calls = JSON.parse(row.tool_call_json) as ToolCallPart[];
    parts.push(...calls);
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    role: row.role as StoredMessage['role'],
    parts,
    toolCallId: row.tool_call_id ?? undefined,
    status: row.status as StoredMessage['status'],
    createdAt: row.created_at,
  };
}

export function createConversation(
  db: Database.Database,
  input: { title?: string },
): ConversationDTO {
  const id = randomUUID();
  const now = Date.now();
  const title = input.title?.trim() || '新对话';
  db.prepare(
    'INSERT INTO conversations (id, title, container_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(id, title, now, now);
  return { id, title, createdAt: now, updatedAt: now };
}

export function listConversations(db: Database.Database): ConversationDTO[] {
  const rows = db
    .prepare('SELECT * FROM conversations ORDER BY updated_at DESC, created_at DESC')
    .all() as { id: string; title: string; created_at: number; updated_at: number }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getConversation(
  db: Database.Database,
  id: string,
): ConversationDTO | null {
  const r = db
    .prepare('SELECT * FROM conversations WHERE id = ?')
    .get(id) as
    | { id: string; title: string; created_at: number; updated_at: number }
    | undefined;
  if (!r) return null;
  return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function deleteConversation(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
}

export function appendMessage(
  db: Database.Database,
  msg: Omit<StoredMessage, 'id' | 'seq' | 'createdAt'>,
): StoredMessage {
  const id = randomUUID();
  const now = Date.now();
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE conversation_id = ?')
    .get(msg.conversationId) as { s: number };
  const seq = row.s;
  const { content, toolCallJson } = serializeParts(msg.parts);
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_call_json, seq, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    msg.conversationId,
    msg.role,
    content,
    msg.toolCallId ?? null,
    toolCallJson,
    seq,
    msg.status,
    now,
  );
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, msg.conversationId);
  return { ...msg, id, seq, createdAt: now };
}

export function listByConv(db: Database.Database, convId: string): StoredMessage[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq ASC')
    .all(convId) as MessageRow[];
  return rows.map(deserializeMessage);
}

export function updateStatus(
  db: Database.Database,
  id: string,
  status: StoredMessage['status'],
): void {
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
}

export function deleteMessage(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM messages WHERE id = ?').run(id);
}

export function findByStatus(
  db: Database.Database,
  status: StoredMessage['status'],
): StoredMessage[] {
  const rows = db
    .prepare('SELECT * FROM messages WHERE status = ? ORDER BY conversation_id, seq ASC')
    .all(status) as MessageRow[];
  return rows.map(deserializeMessage);
}

export function dispatch(
  db: Database.Database,
  method: string,
  params: unknown,
): unknown {
  switch (method) {
    case 'conversations.create':
      return createConversation(db, params as { title?: string });
    case 'conversations.list':
      return listConversations(db);
    case 'conversations.get':
      return getConversation(db, (params as { id: string }).id);
    case 'conversations.delete':
      deleteConversation(db, (params as { id: string }).id);
      return undefined;
    case 'messages.append':
      return appendMessage(db, params as Omit<StoredMessage, 'id' | 'seq' | 'createdAt'>);
    case 'messages.listByConv':
      return listByConv(db, (params as { convId: string }).convId);
    case 'messages.updateStatus':
      return updateStatus(
        db,
        (params as { id: string; status: StoredMessage['status'] }).id,
        (params as { id: string; status: StoredMessage['status'] }).status,
      );
    case 'messages.delete':
      deleteMessage(db, (params as { id: string }).id);
      return undefined;
    case 'messages.findByStatus':
      return findByStatus(db, (params as { status: StoredMessage['status'] }).status);
    default:
      throw new Error(`unknown db method: ${method}`);
  }
}
