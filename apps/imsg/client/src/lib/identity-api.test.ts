import { expect, mock, spyOn, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";

if (process.env.COMMA_IDENTITY_API_TEST_CHILD !== "1") {
  test("identity API reads keep their public contracts and use Convex without Mini requests", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir, env: { ...process.env, COMMA_IDENTITY_API_TEST_CHILD: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const responses = new Map<string, unknown>();
  mock.module("@/lib/identity", () => ({
    convexClient: { query: async (ref: FunctionReference<"query">, args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      calls.push({ name, args });
      return responses.get(name);
    } },
  }));
  mock.module("@/lib/config", () => ({ BASE_URL: "http://mini.invalid" }));
  const { api, avatarUrl, groupPhotoUrl } = await import("./api");

  test("contacts preserve favorites and send no shared key; info and lookup keep their shape and reject misses", async () => {
    const fetch = spyOn(globalThis, "fetch");
    try {
      const contacts = [{ address: "friend@example.com", name: "Current Name", is_favorite: true }];
      responses.set("identity/queries:searchContacts", contacts);
      expect(await api.contacts("current")).toEqual(contacts);
      expect(calls.at(-1)).toEqual({ name: "identity/queries:searchContacts", args: { q: "current" } });
      responses.set("comma/conversationInfo:findChat", { chatGuid: "iMessage;-;friend@example.com", service: "iMessage", isGroup: false, participants: ["friend@example.com"] });
      expect(await api.findChat("friend@example.com")).toMatchObject({ chatGuid: "iMessage;-;friend@example.com" });
      expect(calls.at(-1)).toEqual({ name: "comma/conversationInfo:findChat", args: { address: "friend@example.com" } });
      const info = { guid: "group", displayName: null, isGroup: true, participants: contacts };
      responses.set("comma/conversationInfo:chatInfo", info);
      expect(await api.chatInfo("group")).toEqual(info);
      responses.set("comma/conversationInfo:findChat", null);
      responses.set("comma/conversationInfo:chatInfo", null);
      await expect(api.findChat("missing")).rejects.toThrow("Chat not found");
      await expect(api.chatInfo("missing")).rejects.toThrow("Chat not found");
      expect(avatarUrl("friend@example.com")).toBeNull();
      expect(avatarUrl("friend@example.com", "https://cloud.test/photo")).toBe("https://cloud.test/photo");
      expect(groupPhotoUrl({})).toBeNull();
      expect(groupPhotoUrl({ groupPhotoUrl: "https://cloud.test/group" })).toBe("https://cloud.test/group");
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
}
