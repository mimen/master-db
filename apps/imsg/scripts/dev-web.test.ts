import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";
import {
  assertRealDataCompatibility,
  devWebPort,
  listenerAddresses,
  listenersAreLoopback,
  mainWorktreePath,
  parseDevWebOptions,
  portAvailable,
  reserveDevWebPort,
} from "./dev-web";

describe("dev:web launcher", () => {
  test("requires an explicit supported data mode", () => {
    expect(parseDevWebOptions(["--data=real"])).toEqual({ data: "real", allowServerDrift: false });
    expect(parseDevWebOptions(["--data", "real", "--allow-server-drift"])).toEqual({ data: "real", allowServerDrift: true });
    expect(() => parseDevWebOptions([])).toThrow("--data=real");
    expect(() => parseDevWebOptions(["--data=fixture"])).toThrow("supports only real");
  });

  test("derives a stable isolated port", () => {
    const first = devWebPort("1234567890abcdef");
    expect(first).toBeGreaterThanOrEqual(18_000);
    expect(first).toBeLessThan(19_000);
    expect(devWebPort("1234567890abcdef")).toBe(first);
    expect(devWebPort("abcdef1234567890")).not.toBe(first);
  });

  test("finds the primary default-branch worktree", () => {
    expect(mainWorktreePath([
      "worktree /repo/feature",
      "HEAD abc",
      "branch refs/heads/feature",
      "",
      "worktree /repo/main",
      "HEAD def",
      "branch refs/heads/main",
    ].join("\n"))).toBe("/repo/main");
  });

  test("detects occupied ports", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    expect(await portAvailable(address.port)).toBe(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await portAvailable(address.port)).toBe(true);
  });

  test("reserves alternate ports and identifies duplicate launchers", async () => {
    const instanceHash = "1234567890abcdef";
    const firstPort = devWebPort(instanceHash);
    const occupant = createServer();
    await new Promise<void>((resolve, reject) => {
      occupant.once("error", reject);
      occupant.listen(firstPort, "127.0.0.1", () => resolve());
    });
    const lockRoot = await mkdtemp(join(tmpdir(), "comma-dev-web-"));
    try {
      const results = await Promise.allSettled([
        reserveDevWebPort(instanceHash, lockRoot),
        reserveDevWebPort(instanceHash, lockRoot),
      ]);
      const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveDevWebPort>>> => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(fulfilled[0]!.value.port).not.toBe(firstPort);
      expect(String((rejected[0] as PromiseRejectedResult).reason)).toContain("already running");
      await fulfilled[0]!.value.release();
    } finally {
      await new Promise<void>((resolve) => occupant.close(() => resolve()));
      await rm(lockRoot, { recursive: true, force: true });
    }
  });

  test("requires an explicit override for undeployed server changes", () => {
    expect(() => assertRealDataCompatibility(["apps/imsg/client/src/app.tsx"], false)).not.toThrow();
    expect(() => assertRealDataCompatibility(["apps/imsg/server/app.ts"], false)).toThrow("--allow-server-drift");
    expect(() => assertRealDataCompatibility(["apps/imsg/shared/chat-state.ts"], true)).not.toThrow();
  });

  test("accepts only loopback listener evidence", () => {
    const output = "p123\nn127.0.0.1:18178\n";
    expect(listenerAddresses(output)).toEqual(["127.0.0.1:18178"]);
    expect(listenersAreLoopback(listenerAddresses(output), 18_178)).toBe(true);
    expect(listenersAreLoopback(["*:18178"], 18_178)).toBe(false);
    expect(listenersAreLoopback(["127.0.0.1:18178", "[::]:18178"], 18_178)).toBe(false);
  });
});
