import { afterAll, expect, mock, test } from "bun:test";
import type { ConversationId } from "@shared/types";

if (process.env.COMMA_AVATAR_TEST_CHILD !== "1") {
  test("avatars use Convex photos and render initials on a missing or failed photo", async () => {
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
  afterAll(() => dom.window.close());
  let photoUrl: string | null = "https://convex.test/photo-1";
  let failImage: (() => void) | undefined;
  const handles: Array<string | null> = [];
  mock.module("expo-image", () => ({ Image: (props: { source: { uri?: string }; onError: () => void }) => {
    failImage = props.onError;
    return createElement("img", { src: props.source.uri });
  } }));
  mock.module("@expo/vector-icons/Ionicons", () => ({ default: () => null }));
  mock.module("react-native", () => ({
    View: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
    Text: ({ children }: { children: React.ReactNode }) => createElement("span", null, children),
    StyleSheet: { absoluteFill: {}, create: <T,>(styles: T) => styles },
  }));
  mock.module("@/lib/config", () => ({ BASE_URL: "http://photos.test" }));
  mock.module("@/lib/identity", () => ({
    convexClient: {},
    useWhoIs: (handle: string | null) => {
      handles.push(handle);
      return handle ? { found: true, person: { _id: "person", photoUrl } } : undefined;
    },
  }));
  mock.module("@/hooks/use-theme", () => ({ useTheme: () => ({ avatar: ["#ECECEE", "#E6E6E9"], avatarText: "#3C3C42", background: "#FFFFFF" }) }));
  let groupPhotoUrl: string | null = null;
  const conversations: string[] = [];
  mock.module("@/hooks/use-chat-directory", () => ({
    useConversation: (conversationId: string) => { conversations.push(conversationId); return { groupPhotoUrl }; },
  }));
  const { ChatAvatar, PersonAvatar, GroupPhotoAvatar, avatarSlot } = await import("./avatar");

  test("a contact keeps one ramp slot, and the slot stays inside the ramp", () => {
    expect(avatarSlot("+16195550101", 6)).toBe(avatarSlot("+16195550101", 6));
    const slots = new Set(Array.from({ length: 60 }, (_, i) => avatarSlot(`k${i}`, 6)));
    expect([...slots].every((slot) => slot >= 0 && slot < 6)).toBe(true);
    expect(slots.size).toBe(6);
  });
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
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("P");
      photoUrl = "https://convex.test/photo-2";
      await render();
      expect(container.querySelector("img")?.src).toBe(photoUrl);
      photoUrl = null;
      await render();
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toBe("P");
      photoUrl = "https://convex.test/photo-3";
      expect(avatarUrl("+16195551234", photoUrl)).toBe(photoUrl);
      await render(null);
      expect(container.querySelector("img")).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });
  test("group avatar reads the projected URL and renders its glyph on missing or failed photos", async () => {
    const container = document.getElementById("root");
    if (!container) throw new Error("Missing test root");
    const root = createRoot(container);
    const render = () => act(async () => { root.render(createElement(GroupPhotoAvatar, { conversationId: "group" as ConversationId, size: 40 })); });
    try {
      await render();
      expect(container.querySelector("img")).toBeNull();
      groupPhotoUrl = "https://convex.test/group-1";
      await render();
      expect(container.querySelector("img")?.src).toBe(groupPhotoUrl);
      await act(async () => { failImage?.(); });
      expect(container.querySelector("img")).toBeNull();
      groupPhotoUrl = "https://convex.test/group-2";
      await render();
      expect(container.querySelector("img")?.src).toBe(groupPhotoUrl);
      expect(new Set(conversations)).toEqual(new Set(["group"]));
    } finally { await act(async () => root.unmount()); }
  });
  test("a group of one draws one face, and a channel draws one # tile", async () => {
    const container = document.getElementById("root");
    if (!container) throw new Error("Missing test root");
    const root = createRoot(container);
    photoUrl = null;
    const sam = { address: "sam@example.com", name: "Sam Lee", photoUrl: null };
    const chat = (kind: "thread" | "channel", participants: typeof sam[]) =>
      ({ conversationId: "c", kind, isGroup: true, displayName: "#bookings", participants, groupPhotoUrl: null }) as never;
    try {
      await act(async () => { root.render(createElement(ChatAvatar, { chat: chat("thread", [sam, sam]), size: 40 })); });
      expect(container.textContent).toBe("SL");
      await act(async () => { root.render(createElement(ChatAvatar, { chat: chat("channel", [sam, { ...sam, address: "rd@example.com" }]), size: 40 })); });
      expect(container.textContent).toBe("#");
    } finally { await act(async () => root.unmount()); }
  });
}
