import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { createNdjsonAppender } from "./ndjson";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndjson-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("ndjson appender", () => {
  test("writes events to a per-entity file", async () => {
    const appender = createNdjsonAppender({ baseDir: dir });
    await appender.append("todoist:task:abc", { event: "hello" });
    await appender.append("todoist:task:abc", { event: "world" });
    await appender.append("todoist:task:xyz", { event: "other" });
    const abc = readFileSync(join(dir, "todoist_task_abc.ndjson"), "utf8");
    expect(abc.trim().split("\n")).toHaveLength(2);
    expect(JSON.parse(abc.trim().split("\n")[0]).event).toBe("hello");
    const xyz = readFileSync(join(dir, "todoist_task_xyz.ndjson"), "utf8");
    expect(JSON.parse(xyz.trim()).event).toBe("other");
  });
});
