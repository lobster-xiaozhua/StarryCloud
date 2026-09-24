import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createApp } from '../index.ts';
import { bus } from '../sse/bus.ts';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function getStream(path: string, headers?: Record<string, string>): {
  req: http.ClientRequest;
  body: Promise<string>;
} {
  const chunks: string[] = [];
  const req = http.get(`http://127.0.0.1:${port}${path}`, { headers }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (d) => chunks.push(d as string));
  });
  return {
    req,
    body: new Promise<string>((resolve) => {
      req.on('close', () => resolve(chunks.join('')));
    }),
  };
}

test('GET /api/conversations 列出空列表', async () => {
  const res = await new Promise<http.IncomingMessage>((resolve) => {
    http.get(`http://127.0.0.1:${port}/api/conversations`, (r) => resolve(r));
  });
  expect(res.statusCode).toBe(200);
});

test('SSE 端点：订阅后实时收到 bus 事件，且带 id 行', async () => {
  const runId = 't4-' + Math.random().toString(36).slice(2);
  const { req, body } = getStream(`/api/runs/${runId}/stream`);
  await new Promise((r) => setTimeout(r, 250));
  bus.publish(runId, { event: 'delta', data: { seq: 1, content: 'hi' } });
  await new Promise((r) => setTimeout(r, 250));
  req.destroy();
  const out = await body;
  expect(out).toContain('id: 1');
  expect(out).toContain('event: delta');
  expect(out).toContain('data: ');
});

test('SSE Last-Event-ID 补发：只补发 seq > 已接收', async () => {
  const runId = 't4-le-' + Math.random().toString(36).slice(2);
  bus.publish(runId, { event: 'delta', data: { seq: 1, content: 'a' } });
  bus.publish(runId, { event: 'delta', data: { seq: 2, content: 'b' } });
  bus.publish(runId, { event: 'delta', data: { seq: 3, content: 'c' } });

  const { req, body } = getStream(`/api/runs/${runId}/stream`, {
    'last-event-id': '1',
  });
  await new Promise((r) => setTimeout(r, 250));
  req.destroy();
  const out = await body;
  expect(out).not.toContain('id: 1');
  expect(out).toContain('id: 2');
  expect(out).toContain('id: 3');
});
