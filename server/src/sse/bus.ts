import { RingBuffer } from './ring.ts';
import { SSE_BUFFER_SIZE, type SSEEvent } from '@aiw/contracts/events';

interface Subscriber {
  cb: (ev: SSEEvent) => void;
}

const CLEANUP_MS = 5 * 60 * 1000;

export class RunBus {
  private rings = new Map<string, RingBuffer<SSEEvent>>();
  private subs = new Map<string, Set<Subscriber>>();
  private cleanups = new Map<string, ReturnType<typeof setTimeout>>();

  private ensureRing(runId: string): RingBuffer<SSEEvent> {
    let ring = this.rings.get(runId);
    if (!ring) {
      ring = new RingBuffer<SSEEvent>(SSE_BUFFER_SIZE);
      this.rings.set(runId, ring);
    }
    return ring;
  }

  publish(runId: string, ev: SSEEvent): void {
    const ring = this.ensureRing(runId);
    ring.push(ev.data.seq, ev);
    const set = this.subs.get(runId);
    if (set) for (const s of set) s.cb(ev);
    this.scheduleCleanup(runId);
  }

  subscribe(runId: string, fromSeq: number, cb: (ev: SSEEvent) => void): () => void {
    const ring = this.ensureRing(runId);
    for (const ev of ring.since(fromSeq)) cb(ev);

    let set = this.subs.get(runId);
    if (!set) {
      set = new Set();
      this.subs.set(runId, set);
    }
    const sub: Subscriber = { cb };
    set.add(sub);
    this.cancelCleanup(runId);

    return () => {
      set!.delete(sub);
      if (set!.size === 0) this.subs.delete(runId);
    };
  }

  has(runId: string): boolean {
    return this.rings.has(runId);
  }

  private scheduleCleanup(runId: string): void {
    this.cancelCleanup(runId);
    const t = setTimeout(() => {
      this.rings.delete(runId);
      this.subs.delete(runId);
      this.cleanups.delete(runId);
    }, CLEANUP_MS);
    t.unref?.();
    this.cleanups.set(runId, t);
  }

  private cancelCleanup(runId: string): void {
    const t = this.cleanups.get(runId);
    if (t) {
      clearTimeout(t);
      this.cleanups.delete(runId);
    }
  }
}

export const bus = new RunBus();
