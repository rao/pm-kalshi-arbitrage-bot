import { test, expect, describe } from "bun:test";
import { CircularBuffer } from "../src/utils/circularBuffer";

describe("CircularBuffer", () => {
  test("push and length", () => {
    const buf = new CircularBuffer<number>(5);
    expect(buf.length).toBe(0);

    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.length).toBe(3);
  });

  test("last() returns most recent item", () => {
    const buf = new CircularBuffer<number>(5);
    expect(buf.last()).toBeUndefined();

    buf.push(10);
    expect(buf.last()).toBe(10);

    buf.push(20);
    expect(buf.last()).toBe(20);
  });

  test("toArray returns items oldest-first", () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
  });

  test("overwrites oldest when full", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.length).toBe(3);

    buf.push(4);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);

    buf.push(5);
    expect(buf.toArray()).toEqual([3, 4, 5]);
  });

  test("last() works after overflow", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    expect(buf.last()).toBe(4);
  });

  test("at() returns correct item at logical index", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(10);
    buf.push(20);
    buf.push(30);
    expect(buf.at(0)).toBe(10);
    expect(buf.at(1)).toBe(20);
    expect(buf.at(2)).toBe(30);
    expect(buf.at(3)).toBeUndefined();
    expect(buf.at(-1)).toBeUndefined();

    buf.push(40); // overwrites 10
    expect(buf.at(0)).toBe(20);
    expect(buf.at(1)).toBe(30);
    expect(buf.at(2)).toBe(40);
  });

  test("forEach iterates oldest-first", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // overwrites 1

    const collected: number[] = [];
    buf.forEach((item) => collected.push(item));
    expect(collected).toEqual([2, 3, 4]);
  });

  test("forEach passes correct index", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(10);
    buf.push(20);

    const indices: number[] = [];
    buf.forEach((_, i) => indices.push(i));
    expect(indices).toEqual([0, 1]);
  });

  test("filter returns matching items", () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);

    expect(buf.filter((x) => x > 3)).toEqual([4, 5]);
    expect(buf.filter((x) => x % 2 === 0)).toEqual([2, 4]);
  });

  test("filter works after overflow", () => {
    const buf = new CircularBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);

    expect(buf.filter((x) => x >= 4)).toEqual([4, 5]);
  });

  test("clear resets buffer", () => {
    const buf = new CircularBuffer<number>(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);

    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.last()).toBeUndefined();
    expect(buf.toArray()).toEqual([]);

    // Can be reused after clear
    buf.push(10);
    expect(buf.length).toBe(1);
    expect(buf.last()).toBe(10);
  });

  test("works with object types", () => {
    const buf = new CircularBuffer<{ price: number; ts: number }>(3);
    buf.push({ price: 100, ts: 1 });
    buf.push({ price: 200, ts: 2 });
    buf.push({ price: 300, ts: 3 });
    buf.push({ price: 400, ts: 4 });

    expect(buf.last()).toEqual({ price: 400, ts: 4 });
    expect(buf.toArray()).toEqual([
      { price: 200, ts: 2 },
      { price: 300, ts: 3 },
      { price: 400, ts: 4 },
    ]);
  });

  test("capacity of 1 works correctly", () => {
    const buf = new CircularBuffer<number>(1);
    buf.push(1);
    expect(buf.length).toBe(1);
    expect(buf.last()).toBe(1);

    buf.push(2);
    expect(buf.length).toBe(1);
    expect(buf.last()).toBe(2);
    expect(buf.toArray()).toEqual([2]);
  });

  test("large buffer wraps correctly", () => {
    const buf = new CircularBuffer<number>(100);
    for (let i = 0; i < 250; i++) {
      buf.push(i);
    }
    expect(buf.length).toBe(100);
    expect(buf.at(0)).toBe(150); // oldest
    expect(buf.last()).toBe(249); // newest
    expect(buf.toArray().length).toBe(100);
  });
});
