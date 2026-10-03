import { expect, mock, test } from "bun:test";

const seed = process.env.COMMA_SETTINGS_SEED;
if (!seed) {
  test.each(["missing", "auto", "off", "on", "invalid"])("settings resolution and hydration (%s)", async (value) => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_SETTINGS_SEED: value },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const initial: Record<string, string | null> = {
    missing: null,
    auto: JSON.stringify({ dataSource: "auto", convexSends: "auto" }),
    off: JSON.stringify({ dataSource: "server", convexSends: false }),
    on: JSON.stringify({ dataSource: "convex", convexSends: true }),
    invalid: JSON.stringify({ dataSource: "invalid", convexSends: 1 }),
  };
  let stored = initial[seed];
  let writes = 0;
  mock.module("@react-native-async-storage/async-storage", () => ({
    default: {
      getItem: async () => stored,
      setItem: async (_key: string, value: string) => { stored = value; writes++; },
    },
  }));
  const settings = await import("./settings");
  const { JSDOM } = await import("jsdom");
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");

  test("hooks and non-hook readers follow auth without replacing persisted overrides", async () => {
    const dom = new JSDOM("<div id='root'></div>");
    Object.assign(globalThis, { window: dom.window, document: dom.window.document });
    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.getElementById("root");
    if (!container) throw new Error("Missing test root");
    const root = createRoot(container);
    function Reader() {
      return createElement("span", null, `${settings.useDataSource()}:${settings.useConvexSends()}`);
    }
    const check = (source: "server" | "convex", sends: boolean) => {
      expect(settings.currentDataSource()).toBe(source);
      expect(settings.currentConvexSends()).toBe(sends);
      expect(container.textContent).toBe(`${source}:${sends}`);
    };
    await act(async () => { root.render(createElement(Reader)); });
    check("server", false);
    await act(async () => { settings.setConvexAuthenticated(true); });
    check("convex", true);
    await act(async () => { await settings.hydrateSettings(); });
    check(seed === "off" ? "server" : "convex", seed !== "off");
    await act(async () => { settings.setConvexAuthenticated(false); });
    check("server", false);
    await act(async () => { settings.setConvexAuthenticated(true); });
    check(seed === "off" ? "server" : "convex", seed !== "off");
    expect(writes).toBe(0);
    await act(async () => { settings.setDataSource("convex"); settings.setConvexSends(false); });
    check("convex", false);
    await act(async () => { settings.setDataSource("server"); settings.setConvexSends(true); });
    check("server", true);
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ dataSource: "server", convexSends: true });
    await act(async () => { settings.setDataSource("convex"); settings.setConvexAuthenticated(false); });
    check("server", false);
    await act(async () => { settings.setConvexAuthenticated(true); });
    check("convex", true);
    await act(async () => { settings.setDataSource("auto"); settings.setConvexSends("auto"); });
    check("convex", true);
    expect(JSON.parse(stored ?? "{}")).toMatchObject({ dataSource: "auto", convexSends: "auto" });
    await act(async () => { settings.setConvexAuthenticated(false); });
    check("server", false);
    await act(async () => { root.unmount(); });
    dom.window.close();
  });
}
