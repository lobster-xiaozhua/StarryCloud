import http from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from '../server/src/index.ts';
import { bus } from '../server/src/sse/bus.ts';
import { db } from '../server/src/db/client.ts';

// 隔离数据目录，避免污染真实 data/
const DATA_DIR = path.join(os.tmpdir(), 'aiw-cp2-' + randomUUID());
process.env.DATA_DIR = DATA_DIR;

const server = createApp().listen(0);

function waitListening(): Promise<number> {
  return new Promise((resolve) => server.once('listening', () => {
    resolve((server.address() as AddressInfo).port);
  }));
}

async function postJSON(port: number, p: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function getJSON(port: number, p: string): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  return res.json();
}

async function collectStream(port: number, runId: string, ms = 1500): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/api/runs/${runId}/stream`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let acc = '';
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    if (acc.includes('finishReason')) break;
  }
  reader.cancel().catch(() => undefined);
  return acc;
}

async function main(): Promise<void> {
  const port = await waitListening();
  const base = `http://127.0.0.1:${port}`;

  // 1) 创建会话
  const conv = (await postJSON(port, '/api/conversations', { title: 'cp2' })).json as {
    id: string;
  };
  if (!conv.id) throw new Error('创建会话失败');

  // 2) 发送消息 -> runId
  const msg = (await postJSON(port, `/api/conversations/${conv.id}/messages`, {
    content: '你好',
  })).json as { runId: string };
  if (!msg.runId) throw new Error('POST /messages 未返回 runId');

  // 3) 打开 SSE 流，然后由“假 provider”向 bus 发布事件
  const streamP = collectStream(port, msg.runId, 2000);
  await new Promise((r) => setTimeout(r, 300));

  bus.publish(msg.runId, { event: 'meta', data: { seq: 1, messageId: 'm1' } });
  bus.publish(msg.runId, { event: 'delta', data: { seq: 2, content: '你好' } });
  bus.publish(msg.runId, { event: 'delta', data: { seq: 3, content: '，世界' } });
  bus.publish(msg.runId, { event: 'done', data: { seq: 4, finishReason: 'stop' } });

  const stream = await streamP;

  // 4) 校验：能拿到会话列表 + 流式内容 + done
  const convs = (await getJSON(port, '/api/conversations')) as unknown[];
  if (!Array.isArray(convs) || convs.length < 1) throw new Error('会话列表为空');

  const ok =
    stream.includes('id: 2') &&
    stream.includes('你好') &&
    stream.includes('，世界') &&
    stream.includes('finishReason');

  if (!ok) {
    throw new Error('SSE 流未收到预期事件:\n' + stream);
  }

  console.log('[cp2-e2e] PASS：全栈 HTTP→SSE 流式链路正常');
}

main()
  .then(async () => {
    await db.close();
    server.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('[cp2-e2e] FAIL:', e instanceof Error ? e.message : e);
    await db.close().catch(() => undefined);
    server.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(1);
  });
