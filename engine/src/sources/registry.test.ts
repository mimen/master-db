import { describe, expect, test, vi } from "vitest";

import { createSourceRegistry } from "./registry";
import type { EntitySource } from "./types";

describe("sourceRegistry", () => {
  test("dispatches by entity_type", async () => {
    const todoist: EntitySource = {
      fetch: vi.fn().mockResolvedValue({ content: "task" }),
    };
    const gmail: EntitySource = {
      fetch: vi.fn().mockResolvedValue({ subject: "hi" }),
    };
    const reg = createSourceRegistry({
      todoist_task: todoist,
      gmail_thread: gmail,
    });
    const r1 = await reg.fetch("todoist:task:abc");
    expect(r1).toEqual({ content: "task" });
    expect(todoist.fetch).toHaveBeenCalledWith("todoist:task:abc");
    const r2 = await reg.fetch("gmail:thread:xyz");
    expect(r2).toEqual({ subject: "hi" });
  });

  test("throws on unknown entity_type", async () => {
    const reg = createSourceRegistry({});
    await expect(reg.fetch("unknown:thing:1")).rejects.toThrow(/no source/i);
  });
});
