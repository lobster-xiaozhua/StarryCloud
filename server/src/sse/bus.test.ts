import { expect, test, vi } from 'vitest';
import { RunBus } from './bus.ts';
import { RingBuffer } from './ring.ts';
import type { SSEEvent } from '@aiw/contracts/events';

function ev(seq: number): SSEEvent {
  return { event: 'delta', data: { seq, content: `c${seq}` } };
}

let bus: RunBus;

test('RingBuffer 容量截断：发布 1000 保留 500', () => {
  const ring = new RingBuffer<SSEEvent>(500);
  for (let i = 1; i <= 1000; i++) ring.push(i, ev(i));
  expect(ring.length).toBe(500);
  expect(ring.since(0).length).toBe(500);
  // 保留的是最后 500 条（seq 501..1000）
  const kept = ring.since(0).map((e) => (e.data as { seq: number }).seq);
  expect(Math.min(...kept)).toBe(501);
  expect(Math.max(...kept)).toBe(1000);
});

test('bus：发布 1000 条 → 保留 500 → since(300) 返回 501..1000', () => {
  bus = new RunBus();
  const runId = 'r1';
  for (let i = 1; i <= 1000; i++) bus.publish(runId, ev(i));
  // 订阅者从 seq=0 补发，应拿到保留的 500 条
  const seen: number[] = [];
  bus.subscribe(runId, 0, (e) => seen.push((e.data as { seq: number }).seq));
  expect(seen.length).toBe(500);
  expect(seen[0]).toBe(501);
  expect(seen[seen.length - 1]).toBe(1000);
});

test('subscribe 先补发历史，再收实时；多订阅者广播', () => {
  bus = new RunBus();
  const runId = 'r2';
  bus.publish(runId, ev(1));
  bus.publish(runId, ev(2));

  const a: number[] = [];
  const b: number[] = [];
  bus.subscribe(runId, 0, (e) => a.push((e.data as { seq: number }).seq));
  bus.subscribe(runId, 0, (e) => b.push((e.data as { seq: number }).seq));

  // 补发历史：各 2 条
  expect(a).toEqual([1, 2]);
  expect(b).toEqual([1, 2]);

  // 实时广播：两个订阅者都收到
  bus.publish(runId, ev(3));
  expect(a).toEqual([1, 2, 3]);
  expect(b).toEqual([1, 2, 3]);
});

test('has / 退订', () => {
  bus = new RunBus();
  const runId = 'r3';
  bus.publish(runId, ev(1));
  expect(bus.has(runId)).toBe(true);
  const cb = vi.fn();
  const unsub = bus.subscribe(runId, 0, cb);
  expect(cb).toHaveBeenCalledTimes(1); // 补发历史 seq=1
  unsub();
  bus.publish(runId, ev(99));
  expect(cb).toHaveBeenCalledTimes(1); // 退订后不再收到
});

test('Last-Event-ID 部分补发：fromSeq=600 只拿 601..1000', () => {
  bus = new RunBus();
  const runId = 'r4';
  for (let i = 1; i <= 1000; i++) bus.publish(runId, ev(i));
  const seen: number[] = [];
  bus.subscribe(runId, 600, (e) => seen.push((e.data as { seq: number }).seq));
  expect(seen.length).toBe(400);
  expect(seen[0]).toBe(601);
  expect(seen[seen.length - 1]).toBe(1000);
});
