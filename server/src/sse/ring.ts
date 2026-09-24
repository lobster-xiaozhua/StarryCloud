export class RingBuffer<T> {
  private buf: { seq: number; item: T }[] = [];

  constructor(private readonly size: number) {}

  push(seq: number, item: T): void {
    this.buf.push({ seq, item });
    if (this.buf.length > this.size) this.buf.shift();
  }

  since(seq: number): T[] {
    return this.buf.filter((e) => e.seq > seq).map((e) => e.item);
  }

  get length(): number {
    return this.buf.length;
  }
}
