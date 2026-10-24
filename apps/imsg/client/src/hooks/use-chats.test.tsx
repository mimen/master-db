import { expect, mock, test } from "bun:test";
import type { ChatSummary } from "@shared/types";

if (process.env.COMMA_CHAT_DIRECTORY_CHILD !== "1") {
  test("the chat directory keeps its rows across agent list updates", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_CHAT_DIRECTORY_CHILD: "1" },
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
  const { getFunctionName } = await import("convex/server");
  const dom = new JSDOM("<div id='root'></div>");
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

  const conversation = (id: string) => ({
    _id: id, primaryChatGuid: `guid-${id}`, displayName: id, isGroup: false, hasGroupPhoto: false, participants: [], isSpam: false,
    lastMessage: { guid: `m-${id}`, text: "hi", dateCreated: 1, isFromMe: false, senderName: null, hasAttachments: false },
    unreadCount: 0, flags: { unresponded: true, waiting: false, unread: false, mutedUnresponded: false, pinned: false },
  });
  const results = [conversation("drafted"), conversation("agent"), conversation("plain")];
  const drafts = [{ conversationId: "drafted", text: "hi", updatedAt: 1, source: "user", attachmentCount: 0 }];
  const summary = (thought: string) => [{
    _id: "a1", conversationId: "agent", title: "Venues", state: "running", model: "m", effort: "high", createdAt: 1, updatedAt: 1,
    preview: { kind: "thinking", text: thought },
  }];
  let agentChats = summary("Searching");
  mock.module("react-native", () => ({ Platform: { OS: "web" } }));
  mock.module("@/lib/settings", () => ({ useAgentSettings: () => ({ agentPane: true }) }));
  mock.module("convex/react", () => ({
    usePaginatedQuery: () => ({ results, status: "Exhausted", loadMore: () => undefined }),
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === "comma/agent:listAgentChats" ? agentChats : drafts,
    useConvexConnectionState: () => ({ isWebSocketConnected: true, hasEverConnected: true }),
    optimisticallyUpdateValueInPaginatedQuery: () => undefined,
  }));
  const { ChatDirectoryProvider } = await import("./use-chats");
  const { useChatDirectory } = await import("./use-chat-directory");

  let directory: ChatSummary[] | null = null;
  function Probe() {
    directory = useChatDirectory();
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  const render = () => act(async () => {
    root.render(createElement(ChatDirectoryProvider, null, createElement(Probe)));
  });

  test("an agent list update keeps every row it did not change, drafted ones included", async () => {
    await render();
    const first = directory!;
    expect(first.map((row) => [row.conversationId, row.draft !== undefined, row.agent?.preview?.text])).toEqual([
      ["drafted", true, undefined], ["agent", false, "Searching"], ["plain", false, undefined],
    ]);

    agentChats = summary("Searching");
    await render();
    expect(directory, "the same agents re-sent: the same array").toBe(first);

    agentChats = summary("Listing the venues");
    await render();
    const [drafted, agent, plain] = directory!;
    expect(drafted, "the drafted row with no agent chat").toBe(first[0]!);
    expect(plain).toBe(first[2]!);
    expect(agent).not.toBe(first[1]!);
    expect(agent?.agent?.preview?.text).toBe("Listing the venues");
  });
}
