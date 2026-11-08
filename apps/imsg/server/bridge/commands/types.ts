import type {
  AiKind, CommandResult, CommaOutboxPayload, CoreMessagingKind, GmailOnlyKind, IMessageOnlyKind, LegacyTriageKind,
} from "../../../../../convex/schema/comma/validators";
import type { ChatCommands } from "../../commands";
import type { ConvexIngest } from "../convex-ingest";
import type { OutboxRow } from "../outbox";
import type { MessageWriter } from "../live";

export type CommandKind = CommaOutboxPayload["kind"];
/** The kinds the iMessage lane executes: every messaging kind, iMessage's own, and the legacy triage kinds it refuses. */
export type IMessageKind = CoreMessagingKind | IMessageOnlyKind | LegacyTriageKind;
export type ResultFor<K extends CommandKind> = Extract<CommandResult, { kind: K }>;

interface LaneContext {
  row: OutboxRow;
  signal: AbortSignal;
  /** Starts periodic renewal, also for a handler that opts in dynamically. */
  withLeaseRenewal<T>(work: () => Promise<T>): Promise<T>;
}
export interface IMessageContext extends LaneContext {
  /** Null only for createChat. */
  chatGuid: string | null;
  commands: ChatCommands;
  writer: MessageWriter;
}
/** Model work reads and writes Convex by conversation and never reaches BlueBubbles. */
export interface AiContext extends LaneContext {
  /** Null only for clearSuggestionLearning. */
  conversationId: OutboxRow["conversationId"] | null;
  ingest: Pick<ConvexIngest, "post">;
}

export interface CommandHandler<K extends CommandKind, C = K extends AiKind ? AiContext : IMessageContext> {
  longRunning?: boolean;
  execute(context: C, payload: Extract<CommaOutboxPayload, { kind: K }>): Promise<ResultFor<K>>;
}
export type IMessageHandlers = { [K in IMessageKind]: CommandHandler<K> };
export type AiHandlers = { [K in AiKind]: CommandHandler<K> };
/** Gmail's own kinds run in Convex's Gmail lane, so the Mini has no handler for them. */
export type HandlerMap = IMessageHandlers & AiHandlers & { [K in GmailOnlyKind]?: never };

export function requireChat(context: IMessageContext): string {
  if (!context.chatGuid) throw new Error("Command requires a conversation");
  return context.chatGuid;
}
export function requireConversation(context: AiContext): NonNullable<AiContext["conversationId"]> {
  if (!context.conversationId) throw new Error("Command requires a conversation");
  return context.conversationId;
}
export function accept(result: { ok: boolean; error?: string }): void {
  if (!result.ok) throw new Error(result.error ?? "BlueBubbles operation failed");
}
export function notImplemented<K extends CommandKind>(longRunning = false): CommandHandler<K> {
  return { longRunning, execute: async () => { throw new Error("not implemented"); } };
}
/** Convex applies triage kinds at enqueue. Only a row queued before it did can reach the Mini, and it fails here. */
export function ownedByConvex<K extends CommandKind>(): CommandHandler<K> {
  return { execute: async () => { throw new Error("Convex applies this command; the Mini never executes it"); } };
}
