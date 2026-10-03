import { expect, spyOn, test } from "bun:test";
import { RetryWork } from "./retry";

test("bridge work coalesces, retries failures and never rejects into a caller", async () => {
  let calls = 0;
  const log = spyOn(console, "error").mockImplementation(() => {});
  const work = new RetryWork("test", async () => {
    if (++calls === 1) throw new Error("offline");
  });
  try {
    work.request(100);
    work.request(100);
    await work.flush();
    expect(calls).toBe(1);
    expect(work.pending).toBe(1);
    expect(log).toHaveBeenCalledWith("comma bridge test: Error: offline");
    await work.flush();
    expect(calls).toBe(2);
    expect(work.pending).toBe(0);
    work.stop();
    work.request();
    await work.flush();
    expect(calls).toBe(2);
  } finally { work.stop(); log.mockRestore(); }
});

test("a request during a running snapshot gets a second pass", async () => {
  let calls = 0;
  const work = new RetryWork("test", async () => {
    if (++calls === 1) work.request();
  });
  work.request();
  await work.flush();
  expect(calls).toBe(2);
  work.stop();
});
