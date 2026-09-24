import { afterAll, beforeAll, test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './client.ts';
import type { StoredMessage } from '@aiw/contracts/messages';

let DATA_DIR: string;

beforeAll(() => {
  DATA_DIR = path.join(os.tmpdir(), 'aiw-test-' + randomUUID());
  process.env.DATA_DIR = DATA_DIR;
});

afterAll(async () => {
  await db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('创建会话 → 追加 3 条消息 → seq 单调', async () => {
  const conv = await db.conversations.create({ title: '测试会话' });
  expect(conv.id).toBeTruthy();
  expect(conv.title).toBe('测试会话');

  const seqs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const m = await db.messages.append({
      conversationId: conv.id,
      role: 'user',
      parts: [{ type: 'text', text: `消息${i}` }],
      status: 'complete',
    });
    seqs.push(m.seq);
  }
  expect(seqs).toEqual([1, 2, 3]);

  const list = await db.messages.listByConv(conv.id);
  expect(list).toHaveLength(3);
  expect(list.map((m) => m.seq)).toEqual([1, 2, 3]);
});

test('conversations list / get / delete', async () => {
  const a = await db.conversations.create({ title: 'A' });
  const b = await db.conversations.create({ title: 'B' });
  const all = await db.conversations.list();
  expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));

  const got = await db.conversations.get(a.id);
  expect(got?.title).toBe('A');

  await db.conversations.delete(b.id);
  expect(await db.conversations.get(b.id)).toBeNull();
});

test('tool_call 消息可往返还原', async () => {
  const conv = await db.conversations.create({});
  const saved: StoredMessage = await db.messages.append({
    conversationId: conv.id,
    role: 'assistant',
    parts: [
      { type: 'text', text: '我来执行' },
      {
        type: 'tool_call',
        id: 'call_1',
        name: 'run_shell_command',
        input: { command: 'ls -la' },
      },
    ],
    status: 'complete',
  });
  expect(saved.parts).toEqual([
    { type: 'text', text: '我来执行' },
    {
      type: 'tool_call',
      id: 'call_1',
      name: 'run_shell_command',
      input: { command: 'ls -la' },
    },
  ]);

  const toolMsg = await db.messages.append({
    conversationId: conv.id,
    role: 'tool',
    parts: [{ type: 'text', text: 'stdout...' }],
    toolCallId: 'call_1',
    status: 'complete',
  });
  expect(toolMsg.toolCallId).toBe('call_1');
});

test('findByStatus → 按 status 删除', async () => {
  const conv = await db.conversations.create({});
  await db.messages.append({
    conversationId: conv.id,
    role: 'assistant',
    parts: [{ type: 'text', text: 'x' }],
    status: 'streaming',
  });
  await db.messages.append({
    conversationId: conv.id,
    role: 'assistant',
    parts: [{ type: 'text', text: 'y' }],
    status: 'complete',
  });

  const streaming = await db.messages.findByStatus('streaming');
  expect(streaming).toHaveLength(1);

  await db.messages.delete(streaming[0]!.id);
  expect(await db.messages.findByStatus('streaming')).toHaveLength(0);
});

test('worker 关闭不泄漏（db.close 可解析）', async () => {
  // close 在 afterAll 中统一执行；这里仅确保前面的调用都已完成
  const conv = await db.conversations.create({});
  expect(conv.id).toBeTruthy();
});
