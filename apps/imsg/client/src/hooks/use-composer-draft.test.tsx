import { expect, mock, test } from "bun:test";

if (process.env.COMMA_DRAFT_HOOK_CHILD !== "1") {
  test("composer draft hook respects auth, remote merges and lifecycle flushes", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_DRAFT_HOOK_CHILD: "1" },
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
  const { act, createElement, useState } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { getFunctionName } = await import("convex/server");
  const dom = new JSDOM("<div id='root'></div>");
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  let authenticated = false;
  let remote: { text: string; updatedAt: number } | null = { text: "cloud", updatedAt: 10 };
  const local = new Map<string, string>();
  const listeners = new Set<(guid: string, text: string) => void>();
  const writes: Array<{ conversationId: string; text: string }> = [];
  const queries: Array<{ name: string; skipped: boolean }> = [];
  let imports = 0;

  mock.module("convex/react", () => ({
    useQuery: (ref: Parameters<typeof getFunctionName>[0], args: { chatGuid?: string } | "skip") => {
      const name = getFunctionName(ref);
      queries.push({ name, skipped: args === "skip" });
      if (args === "skip") return undefined;
      return name.endsWith(":resolveChat") ? { _id: `id-${args.chatGuid}` } : remote;
    },
  }));
  mock.module("@/lib/convex-auth", () => ({ useConvexAuth: () => ({ isAuthenticated: authenticated }) }));
  mock.module("@/lib/toast", () => ({ showToast: () => {} }));
  const save = (guid: string, text: string, source = "local") => {
    local.set(guid, text);
    if (source === "local") for (const listener of listeners) listener(guid, text);
  };
  mock.module("@/lib/drafts", () => ({
    getDraft: (guid: string) => local.get(guid) ?? "",
    setDraft: save,
    subscribeDrafts: (listener: (guid: string, text: string) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    uploadLocalDrafts: async () => { imports++; },
  }));
  mock.module("@/lib/identity", () => ({
    convexClient: {
      query: async (_ref: unknown, args: { chatGuid: string }) => ({ _id: `id-${args.chatGuid}` }),
      mutation: async (_ref: unknown, args: { conversationId: string; text: string }) => { writes.push(args); },
    },
  }));
  const { useComposerDraft } = await import("./use-composer-draft");
  let events: ReturnType<typeof useComposerDraft> | undefined;
  function Composer({ guid, editing = false }: { guid: string; editing?: boolean }) {
    const [text, setText] = useState("");
    events = useComposerDraft(guid, editing, setText);
    return createElement("textarea", { value: text, readOnly: true });
  }

  test("real React effects seed, protect typing, flush and retain the local-only fallback", async () => {
    const container = document.getElementById("root");
    if (!container) throw new Error("Missing test root");
    const root = createRoot(container);
    const render = async (guid = "one", editing = false) => {
      await act(async () => { root.render(createElement(Composer, { guid, editing })); });
    };
    await render();
    expect(queries.every((query) => query.skipped)).toBe(true);
    expect(imports).toBe(0);
    authenticated = true;
    await render();
    expect(container.querySelector("textarea")?.value).toBe("cloud");
    expect(local.get("one")).toBe("cloud");
    expect(writes).toEqual([]);
    events?.onFocus();
    save("one", "typing");
    remote = { text: "other device", updatedAt: 20 };
    await render();
    expect(local.get("one")).toBe("typing");
    await act(async () => { events?.onBlur(); });
    expect(writes).toEqual([{ conversationId: "id-one", text: "typing" }]);
    remote = { text: "newest", updatedAt: 30 };
    await render();
    expect(container.querySelector("textarea")?.value).toBe("newest");
    remote = { text: "do not replace editing", updatedAt: 40 };
    await render("one", true);
    expect(local.get("one")).toBe("newest");
    save("one", "switch draft");
    await render("two");
    expect(writes.at(-1)).toEqual({ conversationId: "id-one", text: "switch draft" });
    save("two", "closing draft");
    await act(async () => { root.unmount(); });
    expect(writes.at(-1)).toEqual({ conversationId: "id-two", text: "closing draft" });
    expect(listeners.size).toBe(0);
    dom.window.close();
  });
}
