import { expect, mock, test } from "bun:test";

if (process.env.COMMA_AGENT_HOOK_CHILD !== "1") {
  test("agent availability expires on one timer at the heartbeat's deadline", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_AGENT_HOOK_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const { JSDOM } = await import("jsdom");
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>");
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

  let now = 1_000_000;
  let heartbeatAt: number | null = now - 100_000;
  let agentPane = true;
  Date.now = () => now;
  const timers: { delay: number; fire: () => void; cleared: boolean }[] = [];
  const intervals: number[] = [];
  const realTimeout = globalThis.setTimeout;
  // React's scheduler uses short timeouts of its own; the hook's are the long ones.
  globalThis.setTimeout = ((fire: () => void, delay = 0, ...rest: unknown[]) => {
    if (delay < 1_000) return realTimeout(fire, delay, ...rest);
    const timer = { delay, fire, cleared: false };
    timers.push(timer);
    return timer;
  }) as typeof setTimeout;
  const realClear = globalThis.clearTimeout;
  globalThis.clearTimeout = ((timer: { cleared?: boolean }) => {
    if (timers.includes(timer as never)) (timer as { cleared: boolean }).cleared = true;
    else realClear(timer as never);
  }) as typeof clearTimeout;
  globalThis.setInterval = ((_fire: () => void, delay: number) => { intervals.push(delay); return 0; }) as unknown as typeof setInterval;

  const convexReact = await import("convex/react");
  mock.module("convex/react", () => ({ ...convexReact, useQuery: () => ({ suggestions: true, reactionSuggestions: true, agentHeartbeatAt: heartbeatAt }) }));
  mock.module("@/lib/settings", () => ({ useAgentSettings: () => ({ agentPane }) }));
  const { useAgentEnabled } = await import("./use-agent");
  const { AiStatusProvider } = await import("./use-ai");
  const { memo } = await import("react");
  let enabled: boolean | undefined;
  let probeRenders = 0;
  const Probe = memo(function Probe() {
    probeRenders++;
    enabled = useAgentEnabled();
    return null;
  });
  const probe = createElement(Probe);

  test("arms one timeout at heartbeatAt + AGENT_FRESH_MS, re-arms on a new heartbeat without rerendering readers, and honours the setting", async () => {
    const root = createRoot(document.getElementById("root")!);
    const render = async () => { await act(async () => { root.render(createElement(AiStatusProvider, null, probe)); }); };
    const live = () => timers.filter((timer) => !timer.cleared);

    await render();
    expect(enabled).toBe(true);
    expect(live().map((timer) => timer.delay)).toEqual([20_001]);

    const rendersBeforeBeat = probeRenders;
    now += 10_000;
    heartbeatAt = now;
    await render();
    expect(live().map((timer) => timer.delay)).toEqual([120_001]);
    expect(probeRenders, "a fresh heartbeat does not rerender a reader").toBe(rendersBeforeBeat);

    now += 120_001;
    await act(async () => { live()[0].fire(); });
    expect(enabled).toBe(false);

    heartbeatAt = now;
    agentPane = false;
    await render();
    expect(enabled).toBe(false);
    expect(intervals).toEqual([]);
    await act(async () => { root.unmount(); });
    dom.window.close();
  });
}
