import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentEnabled, childEnv, loadAgentConfig, queryOptions, reserveSession, type AgentConfig } from "./main";
import { fakeId } from "./query-fake";
import { commaServer } from "./tools";

const env = { CONVEX_CLOUD_URL: "https://x.convex.cloud/", CONVEX_SITE_URL: "https://x.convex.site", COMMA_BRIDGE_SECRET: "secret", HOME: "/Users/test" };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("comma agent main", () => {
  test("is enabled only by an explicit COMMA_AGENT_ENABLED", () => {
    expect(agentEnabled({})).toBe(false);
    expect(agentEnabled({ COMMA_AGENT_ENABLED: "false" })).toBe(false);
    expect(agentEnabled({ COMMA_AGENT_ENABLED: "0" })).toBe(false);
    expect(agentEnabled({ COMMA_AGENT_ENABLED: "true" })).toBe(true);
    expect(agentEnabled({ COMMA_AGENT_ENABLED: "1" })).toBe(true);
  });

  test("a disabled runner stays up and idles without a heartbeat", async () => {
    const child = Bun.spawn(["bun", "--no-env-file", join(import.meta.dir, "main.ts")], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stderr: "pipe",
      stdout: "pipe",
    });
    await Bun.sleep(1500);
    const exited = child.exitCode !== null;
    child.kill();
    const stderr = await new Response(child.stderr).text();
    expect(exited).toBe(false);
    expect(stderr).toContain("idling without a heartbeat");
    expect(stderr).not.toContain("heartbeat:");
  });

  test("requires the Convex and gateway settings once enabled", () => {
    expect(() => loadAgentConfig({ ...env, COMMA_BRIDGE_SECRET: "" }, "key")).toThrow("COMMA_BRIDGE_SECRET");
    expect(() => loadAgentConfig(env, "")).toThrow("AI_GATEWAY_KEY");
    expect(loadAgentConfig(env, "key")).toMatchObject({
      convexCloudUrl: "https://x.convex.cloud",
      addendumPath: "/Users/mimen/Documents/milad-vault/ClaudeConfig/references/comma-agent.md",
      scratchRoot: "/Users/test/.local/share/comma-agent",
      gatewayUrl: "http://127.0.0.1:8317",
      ccsBin: "ccs",
    });
  });

  test("builds the spike's SDK options with the chat's model and effort", () => {
    const config = loadAgentConfig(env, "gateway-key");
    const mcp = commaServer({ port: { post: async () => null as never, upload: async () => fakeId("") }, chatId: fakeId("c"), conversationId: fakeId("v"), scratchDir: "/tmp", timeZone: "UTC", fetch });
    const base = { chatId: fakeId<"comma_agent_chats">("c"), sessionId: "s-1", append: "You are a Comma agent", cwd: "/tmp/c", env: childEnv(config, { PROCID: "comma:agent", PATH: "/bin" }), mcp };
    const chat = { conversationId: fakeId<"comma_conversations">("v"), model: "claude-opus-5-5", effort: "high" as const, state: "pending" as const };
    const fresh = queryOptions(config, { ...base, chat, resume: false });
    expect(fresh).toMatchObject({
      model: "claude-opus-5-5",
      effort: "high",
      executable: "bun",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      cwd: "/tmp/c",
      sessionId: "s-1",
      settings: { enabledPlugins: { "pstack@house": false, "ponytail@ponytail": false } },
      systemPrompt: { type: "preset", preset: "claude_code", append: "You are a Comma agent" },
      env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8317", ANTHROPIC_API_KEY: "gateway-key", COMMA_AGENT: "1", PATH: "/bin" },
    });
    expect(fresh.env).not.toHaveProperty("PROCID");
    expect(fresh.mcpServers).toHaveProperty("comma");
    const resumed = queryOptions(config, { ...base, chat, resume: true });
    expect(resumed.resume).toBe("s-1");
    expect(resumed).not.toHaveProperty("sessionId");
  });

  test("the Claude child gets the gateway key only as ANTHROPIC_API_KEY and none of the runner's secrets", () => {
    const config = loadAgentConfig(env, "gateway-key");
    const secrets = {
      COMMA_BRIDGE_SECRET: "s", BB_PASSWORD: "s", IMSG_SERVER_SECRET: "s", IMSG_IDENTITY_KEY: "s", AI_GATEWAY_KEY: "gateway-key",
      CLAUDE_GPT_GATEWAY_API_KEY: "gateway-key", OTHER_SECRET: "s", DB_PASSWORD: "s", GITHUB_TOKEN: "s",
    };
    const child = childEnv(config, { ...secrets, PATH: "/bin", HOME: "/Users/test", TOKEN_PATH: "/tmp/x" });
    expect(child).toEqual({
      PATH: "/bin", HOME: "/Users/test", TOKEN_PATH: "/tmp/x",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:8317", ANTHROPIC_API_KEY: "gateway-key", COMMA_AGENT: "1",
    });
  });

  test("reserves a ccs session as the comma-agent automation and reads the id from the last line", async () => {
    const root = mkdtempSync(join(tmpdir(), "comma-agent-ccs-"));
    roots.push(root);
    const bin = join(root, "ccs");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > "${root}/args"\necho "$CCS_CREATOR_KIND/$CCS_CREATOR_REF" > "${root}/creator"\necho "reserving"\necho "0f8c1d2e-session"\n`);
    chmodSync(bin, 0o755);
    const config = { ...loadAgentConfig(env, "k"), ccsBin: bin } satisfies AgentConfig;
    expect(await reserveSession(config, "/tmp/chat", "Comma · Jesse Brennan")).toBe("0f8c1d2e-session");
    expect(await Bun.file(join(root, "args")).text()).toBe(
      ["session", "new", "--top-level", "--print-id", "--cwd", "/tmp/chat", "--title", "Comma · Jesse Brennan", "--category", "personal-apps", ""].join("\n"),
    );
    expect((await Bun.file(join(root, "creator")).text()).trim()).toBe("automation/comma-agent");
  });
});
