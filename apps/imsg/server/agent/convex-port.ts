import { ConvexClient } from "convex/browser";
import { anyApi, type FunctionArgs, type FunctionReturnType } from "convex/server";
import type { api, internal } from "../../../../convex/_generated/api";
import type { AgentEntry, PendingAgentCommand } from "../../../../convex/schema/comma/validators";
import { ConvexIngest } from "../bridge/convex-ingest";

export type { AgentAttachmentLink, AgentChatState, AgentEffort, AgentEntry, AgentQuestion } from "../../../../convex/schema/comma/validators";
export type CommandRow = PendingAgentCommand;
export type Command = CommandRow["command"];
export type Chat = CommandRow["chat"];
export type ChatId = CommandRow["chatId"];
export type ConversationId = Chat["conversationId"];
export type Item = { key: string; entry: AgentEntry };

/** The bridge ingest routes the runner posts to, each the internal mutation of the same name. */
type Refs = Pick<typeof internal.comma.agent, "agentClaim" | "agentRecover" | "agentChat" | "agentItems" | "agentHeartbeat" | "agentDraft" | "agentSend">
  & typeof internal.comma.agentContext
  & { agentRecordUpload: typeof internal.comma.drafts.recordUpload };
export type Routes = { [K in keyof Refs]: [FunctionArgs<Refs[K]>, FunctionReturnType<Refs[K]>] };

export type ThreadContext = Routes["agentContext"][1];
export type ThreadMessage = ThreadContext["messages"][number];
export type StorageId = Routes["agentRecordUpload"][0]["storageId"];

export type Port = {
  post<K extends keyof Routes>(route: K, body: Routes[K][0]): Promise<Routes[K][1]>;
  upload(bytes: Uint8Array, mime: string): Promise<StorageId>;
};

const pendingAgentCommands = (anyApi.comma.agent as unknown as typeof api.comma.agent).pendingAgentCommands;

/** The runner's writes and reads, over the bridge ingest routes. */
export function ingestPort(config: { convexSiteUrl: string; commaBridgeSecret: string }): Port {
  const ingest = new ConvexIngest(config);
  return {
    post: <K extends keyof Routes>(route: K, body: Routes[K][0]) => ingest.request<Routes[K][1]>(route, body),
    // The upload endpoint answers with the storage id Convex issued.
    upload: async (bytes, mime) => await ingest.upload(bytes, mime) as StorageId,
  };
}

export function convexPort(config: { convexCloudUrl: string; convexSiteUrl: string; commaBridgeSecret: string }) {
  const client = new ConvexClient(config.convexCloudUrl);
  return {
    port: ingestPort(config),
    subscribe: (receive: (rows: CommandRow[]) => void): (() => void) =>
      client.onUpdate(pendingAgentCommands, { bridgeKey: config.commaBridgeSecret }, receive,
        (error) => console.error(`comma agent subscription: ${String(error)}`)),
    close: () => client.close(),
  };
}
