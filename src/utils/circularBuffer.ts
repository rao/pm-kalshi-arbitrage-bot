/**
 * Fixed-size circular (ring) buffer.
 *
 * Replaces the common pattern of `arr.push(item); if (arr.length > N) arr = arr.slice(-N);`
 * which is O(n) per trim, with O(1) push and O(1) last().
 */
export class CircularBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private _length = 0;

  constructor(readonly capacity: number) {
    this.buf = new Array(capacity);
  }

  /** Add an item. O(1). Overwrites oldest entry when full. */
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._length < this.capacity) this._length++;
  }

  /** Number of items currently stored. */
  get length(): number {
    return this._length;
  }

  /** Get the most recently pushed item. O(1). */
  last(): T | undefined {
    if (this._length === 0) return undefined;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return this.buf[idx];
  }

  /** Get item at logical index (0 = oldest). O(1). */
  at(index: number): T | undefined {
    if (index < 0 || index >= this._length) return undefined;
    const start = (this.head - this._length + this.capacity) % this.capacity;
    return this.buf[(start + index) % this.capacity];
  }

  /** Iterate all items oldest-first without allocating an array. */
  forEach(fn: (item: T, index: number) => void): void {
    const start = (this.head - this._length + this.capacity) % this.capacity;
    for (let i = 0; i < this._length; i++) {
      fn(this.buf[(start + i) % this.capacity] as T, i);
    }
  }

  /** Return items as a new array (oldest first). O(n). */
  toArray(): T[] {
    const result: T[] = new Array(this._length);
    const start = (this.head - this._length + this.capacity) % this.capacity;
    for (let i = 0; i < this._length; i++) {
      result[i] = this.buf[(start + i) % this.capacity] as T;
    }
    return result;
  }

  /** Filter items matching a predicate. Returns new array. */
  filter(fn: (item: T) => boolean): T[] {
    const result: T[] = [];
    const start = (this.head - this._length + this.capacity) % this.capacity;
    for (let i = 0; i < this._length; i++) {
      const item = this.buf[(start + i) % this.capacity] as T;
      if (fn(item)) result.push(item);
    }
    return result;
  }

  /** Reset the buffer to empty. */
  clear(): void {
    this.head = 0;
    this._length = 0;
    // Don't reallocate — just let old references get GC'd as they're overwritten
  }
}
