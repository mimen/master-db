import { describe, expect, test } from "bun:test";
import type { AiConfig } from "../config";
import {
  anchorCommand,
  automationEnv,
  delegateCommand,
  parseAnchorId,
  probeShadow,
  ShadowRunner,
  type AnchorStore,
  type ExecResult,
} from "./shadow";

const ANCHOR = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    gatewayUrl: "http://127.0.0.1:8317",
    gatewayKey: "key",
    fastModel: "gpt-5.6-luna(low)",
    vaultPath: "/vault",
    creatorRef: "imsg-shadow",
    shadowSeat: "imsg-shadow",
    shadowCwd: "/repo/apps/imsg",
    ccsBin: "ccs",
    ...overrides,
  };
}

function makeStore(initial: Record<string, string> = {}): AnchorStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: (key) => data[key] ?? null,
    set: (key, value) => {
      data[key] = value;
    },
  };
}

function ok(stdout: string): ExecResult {
  return { stdout, stderr: "", exitCode: 0 };
}

describe("automationEnv", () => {
  test("declares automation provenance with a stable ref", () => {
    expect(automationEnv("imsg-shadow")).toEqual({
      CCS_CREATOR_KIND: "automation",
      CCS_CREATOR_REF: "imsg-shadow",
    });
  });

  test("throws on an empty ref, which CCS would reject anyway", () => {
    expect(() => automationEnv("")).toThrow(/stable, non-empty/);
    expect(() => automationEnv("   ")).toThrow();
  });
});

describe("anchorCommand", () => {
  test("reserves a top-level id without launching", () => {
    const spec = anchorCommand(makeConfig());
    expect(spec.command).toBe("ccs");
    expect(spec.args).toContain("--print-id");
    expect(spec.args).toContain("--top-level");
    expect(spec.env.CCS_CREATOR_KIND).toBe("automation");
  });

  test("passes the configured cwd", () => {
    const spec = anchorCommand(makeConfig({ shadowCwd: "/somewhere/else" }));
    expect(spec.args[spec.args.indexOf("--cwd") + 1]).toBe("/somewhere/else");
  });
});

describe("delegateCommand", () => {
  test("parents the turn to the anchor and names the seat", () => {
    const spec = delegateCommand(makeConfig(), ANCHOR, "hello");
    expect(spec.args[0]).toBe("delegate");
    expect(spec.args[1]).toBe("imsg-shadow");
    expect(spec.args[spec.args.indexOf("--child-of") + 1]).toBe(ANCHOR);
    expect(spec.args[spec.args.indexOf("--prompt") + 1]).toBe("hello");
  });

  test("passes the prompt as one argv entry, never a shell string", () => {
    const nasty = 'hi"; rm -rf / #';
    const spec = delegateCommand(makeConfig(), ANCHOR, nasty);
    expect(spec.args).toContain(nasty);
  });
});

describe("parseAnchorId", () => {
  test("extracts a bare uuid", () => {
    const result = parseAnchorId(`${ANCHOR}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(ANCHOR);
  });

  test("extracts a uuid despite wrapper noise", () => {
    const result = parseAnchorId(`reserved session\n${ANCHOR}\n`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(ANCHOR);
  });

  test("fails when no id is present", () => {
    expect(parseAnchorId("error: something went wrong").ok).toBe(false);
  });
});

describe("probeShadow", () => {
  const present = { which: () => "/path/to/ccs", seatExists: () => true };

  test("available when key, ccs, and seat are all present", () => {
    const result = probeShadow(makeConfig(), present);
    expect(result.available).toBe(true);
    expect(result.detail).toBeNull();
  });

  test("reports the missing key first", () => {
    const result = probeShadow(makeConfig({ gatewayKey: "" }), present);
    expect(result.available).toBe(false);
    expect(result.detail).toContain("key");
  });

  test("reports ccs missing from PATH", () => {
    const result = probeShadow(makeConfig(), { which: () => null, seatExists: () => true });
    expect(result.available).toBe(false);
    expect(result.detail).toContain("ccs not found");
  });

  test("reports an unsynced seat", () => {
    const result = probeShadow(makeConfig(), { which: () => "/ccs", seatExists: () => false });
    expect(result.available).toBe(false);
    expect(result.detail).toContain("synced");
  });

  test("checks the seat under the configured vault path", () => {
    let checkedDir = "";
    probeShadow(makeConfig({ vaultPath: "/v", shadowSeat: "imsg-shadow" }), {
      which: () => "/ccs",
      seatExists: (dir) => {
        checkedDir = dir;
        return true;
      },
    });
    expect(checkedDir).toBe("/v/ClaudeConfig/seats/imsg-shadow");
  });
});

describe("ShadowRunner", () => {
  test("reserves an anchor once and persists it", async () => {
    const store = makeStore();
    let calls = 0;
    const runner = new ShadowRunner(makeConfig(), store, async () => {
      calls++;
      return ok(ANCHOR);
    });

    expect((await runner.ensureAnchor()).ok).toBe(true);
    await runner.ensureAnchor();
    expect(calls).toBe(1);
    expect(store.data.shadow_anchor_session_id).toBe(ANCHOR);
  });

  test("reuses a persisted anchor without shelling out", async () => {
    const store = makeStore({ shadow_anchor_session_id: ANCHOR });
    const runner = new ShadowRunner(makeConfig(), store, async () => {
      throw new Error("should not exec");
    });
    const result = await runner.ensureAnchor();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(ANCHOR);
  });

  test("a turn delegates against the anchor and returns stdout", async () => {
    const store = makeStore({ shadow_anchor_session_id: ANCHOR });
    const runner = new ShadowRunner(makeConfig(), store, async (spec) => {
      expect(spec.args[0]).toBe("delegate");
      return ok("probably Sarah Chen\n");
    });
    const result = await runner.turn("who is this");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("probably Sarah Chen");
  });

  test("surfaces a nonzero exit instead of retrying", async () => {
    const store = makeStore({ shadow_anchor_session_id: ANCHOR });
    let calls = 0;
    const runner = new ShadowRunner(makeConfig(), store, async () => {
      calls++;
      return { stdout: "", stderr: "seat not found", exitCode: 1 };
    });
    const result = await runner.turn("hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("seat not found");
    expect(calls).toBe(1);
  });

  test("treats empty output as a failure", async () => {
    const store = makeStore({ shadow_anchor_session_id: ANCHOR });
    const runner = new ShadowRunner(makeConfig(), store, async () => ok("   \n"));
    expect((await runner.turn("hi")).ok).toBe(false);
  });

  test("does not persist an anchor when reservation fails", async () => {
    const store = makeStore();
    const runner = new ShadowRunner(makeConfig(), store, async () => ({
      stdout: "",
      stderr: "boom",
      exitCode: 2,
    }));
    expect((await runner.ensureAnchor()).ok).toBe(false);
    expect(store.data.shadow_anchor_session_id).toBeUndefined();
  });

  test("reports a misconfigured creator ref without shelling out", async () => {
    const runner = new ShadowRunner(makeConfig({ creatorRef: "" }), makeStore(), async () => {
      throw new Error("should not exec");
    });
    const result = await runner.ensureAnchor();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("stable, non-empty");
  });
});
