import { describe, expect, test, vi } from "vitest";

import { createPerEntityQueue } from "./perEntityQueue";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("perEntityQueue", () => {
  test("serializes work for the same entity", async () => {
    const order: number[] = [];
    const q = createPerEntityQueue({ onInterrupt: async () => {} });
    const work = (n: number) => async () => {
      await tick();
      order.push(n);
    };
    q.enqueue("e1", work(1));
    q.enqueue("e1", work(2));
    q.enqueue("e1", work(3));
    await q.drainAll();
    expect(order).toEqual([1, 2, 3]);
  });

  test("different entities run independently", async () => {
    const q = createPerEntityQueue({ onInterrupt: async () => {} });
    let a = false;
    let b = false;
    const pa = q.enqueue("a", async () => {
      a = true;
    });
    const pb = q.enqueue("b", async () => {
      b = true;
    });
    await Promise.all([pa, pb]);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  test("interrupt drops queued items and calls onInterrupt", async () => {
    const onInterrupt = vi.fn(async () => {});
    const q = createPerEntityQueue({ onInterrupt });
    let firstStarted = false;
    let secondCalled = false;
    q.enqueue("e1", async () => {
      firstStarted = true;
      await new Promise((r) => setTimeout(r, 50));
    });
    q.enqueue("e1", async () => {
      secondCalled = true;
    });
    await tick();
    expect(firstStarted).toBe(true);
    q.interrupt("e1");
    await new Promise((r) => setTimeout(r, 100));
    expect(secondCalled).toBe(false);
    expect(onInterrupt).toHaveBeenCalledWith("e1");
  });

  test("isBusy reflects in-flight state", async () => {
    const q = createPerEntityQueue({ onInterrupt: async () => {} });
    expect(q.isBusy("e1")).toBe(false);
    q.enqueue("e1", async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    await tick();
    expect(q.isBusy("e1")).toBe(true);
    await q.drainAll();
    expect(q.isBusy("e1")).toBe(false);
  });
});
