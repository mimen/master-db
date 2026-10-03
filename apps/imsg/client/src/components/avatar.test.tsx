import { expect, mock, test } from "bun:test";

if (process.env.COMMA_AVATAR_TEST_CHILD !== "1") {
  test("avatars prefer Convex photos only in Convex mode and retain their fallback", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir, env: { ...process.env, COMMA_AVATAR_TEST_CHILD: "1" }, stdout: "pipe", stderr: "pipe",
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
  let mode = "convex";
  let photoUrl: string | null = "https://convex.test/photo-1";
  let failImage: (() => void) | undefined;
  const handles: Array<string | null> = [];
  mock.module("expo-image", () => ({ Image: (props: { source: { uri?: string }; onError: () => void }) => {
    failImage = props.onError;
    return createElement("img", { src: props.source.uri });
  } }));
  mock.module("expo-linear-gradient", () => ({ LinearGradient: () => null }));
  mock.module("@expo/vector-icons", () => ({ Ionicons: () => null }));
  mock.module("react-native", () => ({
    View: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
    Text: ({ children }: { children: React.ReactNode }) => createElement("span", null, children),
    StyleSheet: { absoluteFill: {}, create: <T,>(styles: T) => styles },
  }));
  mock.module("@/lib/config", () => ({ BASE_URL: "http://photos.test" }));
  mock.module("@/lib/settings", () => ({
    currentDataSource: () => mode, useDataSource: () => mode, currentConvexSends: () => false,
  }));
  mock.module("@/lib/identity", () => ({
    convexClient: {},
    useWhoIs: (handle: string | null) => {
      handles.push(handle);
      return handle ? { found: true, person: { _id: "person", photoUrl } } : undefined;
    },
  }));
  mock.module("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
  const { PersonAvatar } = await import("./avatar");
  const { avatarUrl } = await import("../lib/api");

  test("renders cloud photos, falls back on errors, and accepts a changed cloud photo", async () => {
    const container = document.getElementById("root");
    if (!container) throw new Error("Missing test root");
    const root = createRoot(container);
    const render = async (address: string | null = "person@example.com") => {
      await act(async () => { root.render(createElement(PersonAvatar, { address, name: "Person", size: 40 })); });
    };
    try {
      await render();
      expect(container.querySelector("img")?.src).toBe("https://convex.test/photo-1");
      await act(async () => { failImage?.(); });
      expect(container.querySelector("img")?.src).toBe("http://photos.test/api/avatars/person%40example.com?v=3");
      photoUrl = "https://convex.test/photo-2";
      await render();
      expect(container.querySelector("img")?.src).toBe(photoUrl);
      photoUrl = null;
      await render();
      expect(container.querySelector("img")?.src).toBe("http://photos.test/api/avatars/person%40example.com?v=3");
      mode = "server";
      photoUrl = "https://convex.test/photo-3";
      await render();
      expect(handles.at(-1)).toBeNull();
      expect(container.querySelector("img")?.src).toBe("http://photos.test/api/avatars/person%40example.com?v=3");
      expect(avatarUrl("+16195551234", photoUrl)).toBe("http://photos.test/api/avatars/%2B16195551234?v=3");
      mode = "convex";
      expect(avatarUrl("+16195551234", photoUrl)).toBe(photoUrl);
      await render(null);
      expect(container.querySelector("img")).toBeNull();
    } finally { await act(async () => root.unmount()); dom.window.close(); }
  });
}
