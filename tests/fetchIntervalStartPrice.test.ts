import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { fetchIntervalStartPrice } from "../src/data/fetchIntervalStartPrice";

describe("fetchIntervalStartPrice", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("converts Unix seconds to Binance ms format in URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock(async (url: any) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify([{ p: "97000.50" }]), { status: 200 });
    }) as any;

    await fetchIntervalStartPrice(1700000000);

    expect(capturedUrl).toContain("startTime=1700000000000");
    expect(capturedUrl).toContain("endTime=1700000001000");
    expect(capturedUrl).toContain("symbol=BTCUSDT");
  });

  test("parses aggTrade response price field correctly", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify([
          { a: 123, p: "97234.56", q: "0.001", f: 1, l: 1, T: 1700000000000, m: false, M: true },
        ]),
        { status: 200 }
      );
    }) as any;

    const price = await fetchIntervalStartPrice(1700000000);
    expect(price).toBe(97234.56);
  });

  test("returns null on empty response array", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify([]), { status: 200 });
    }) as any;

    const price = await fetchIntervalStartPrice(1700000000);
    expect(price).toBeNull();
  });

  test("returns null on fetch error (network failure)", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network error");
    }) as any;

    const price = await fetchIntervalStartPrice(1700000000);
    expect(price).toBeNull();
  });

  test("returns null on non-200 response", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" });
    }) as any;

    const price = await fetchIntervalStartPrice(1700000000);
    expect(price).toBeNull();
  });

  test("returns null on unparseable price string", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify([{ p: "not_a_number" }]), { status: 200 });
    }) as any;

    const price = await fetchIntervalStartPrice(1700000000);
    expect(price).toBeNull();
  });
});
