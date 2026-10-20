import { ConvexClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexIngest } from "../bridge/convex-ingest";

// Hand-written mirror of convex/comma/agent.ts; the generated API on this branch predates it.
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ChatState = "idle" | "pending" | "running" | "waiting_input" | "interrupted" | "failed";
export type Question = {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
};
export type Entry =
  | { kind: "assistant" | "thinking"; text: string; streaming: boolean }
  | { kind: "tool"; name: string; summary: string; detail?: string; status: "running" | "done" | "failed" }
  | { kind: "question"; requestId: string; questions: Question[]; status: "pending" | "resolved" | "cancelled"; answers?: Record<string, string> }
  | { kind: "turn_end"; outcome: "completed" | "interrupted" | "failed"; error?: string; durationMs?: number };
export type Item = { key: string; entry: Entry };
export type Chat = {
  conversationId: string;
  sessionId?: string;
  model: string;
  effort: Effort;
  state: ChatState;
  seenThroughMessageAt?: number;
  archivedAt?: number;
};
export type Command =
  | { kind: "message"; text: string; steer: boolean }
  | { kind: "answer"; requestId: string; answers: Record<string, string> }
  | { kind: "stop" }
  | { kind: "close" };
export type CommandRow = { _id: string; chatId: string; command: Command; createdAt: number; chat: Chat };
export type ThreadMessage = {
  guid: string;
  at: number;
  fromMe: boolean;
  sender: string;
  text: string;
  attachments: { guid: string; name: string; mime: string }[];
};
export type ThreadContext = { title: string; participants: { name: string; handles: string[] }[]; messages: ThreadMessage[] };

export type Routes = {
  agentClaim: [{ ids: string[] }, CommandRow[]];
  agentRecover: [{ now: number }, { chatIds: string[] }];
  agentChat: [{ chatId: string; sessionId?: string; state?: ChatState; seenThroughMessageAt?: number }, unknown];
  agentItems: [{ chatId: string; items: Item[] }, unknown];
  agentHeartbeat: [{ now: number }, unknown];
  agentContext: [{ conversationId: string; sinceMessageAt?: number; beforeMessageAt?: number; limit: number }, ThreadContext];
  agentSearch: [{ conversationId: string; query: string }, unknown];
  agentPeople: [{ conversationId: string }, unknown];
  agentAttachment: [{ guid: string }, { url: string; name: string; mime: string } | null];
  agentDraft: [{ chatId: string; conversationId: string; itemKey: string; text: string; note?: string; attachments?: string[] }, { placed: "composer" | "pane" }];
  agentSend: [{ conversationId: string; clientKey: string; text: string }, unknown];
  agentRecordUpload: [{ storageId: string; filename: string; mimeType: string }, { storageId: string; size: number }];
};

export type Port = {
  post<K extends keyof Routes>(route: K, body: Routes[K][0]): Promise<Routes[K][1]>;
  upload(bytes: Uint8Array, mime: string): Promise<string>;
};

const pendingAgentCommands = makeFunctionReference<"query", { bridgeKey: string }, CommandRow[]>("comma/agent:pendingAgentCommands");

export function convexPort(config: { convexCloudUrl: string; convexSiteUrl: string; commaBridgeSecret: string }) {
  const ingest = new ConvexIngest(config);
  const client = new ConvexClient(config.convexCloudUrl);
  const port: Port = {
    post: <K extends keyof Routes>(route: K, body: Routes[K][0]) => ingest.request<Routes[K][1]>(route, body),
    upload: (bytes, mime) => ingest.upload(bytes, mime),
  };
  return {
    port,
    subscribe: (receive: (rows: CommandRow[]) => void): (() => void) =>
      client.onUpdate(pendingAgentCommands, { bridgeKey: config.commaBridgeSecret }, receive,
        (error) => console.error(`comma agent subscription: ${String(error)}`)),
    close: () => client.close(),
  };
}
