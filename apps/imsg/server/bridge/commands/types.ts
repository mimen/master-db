import type { CommandResult, CommaOutboxPayload } from "../../../../../convex/schema/comma/validators";
import type { ChatCommands } from "../../commands";
import type { OutboxRow } from "../outbox";
import type { MessageWriter } from "../live";

export type CommandKind = CommaOutboxPayload["kind"];
export type ResultFor<K extends CommandKind> = Extract<CommandResult, { kind: K }>;
export interface CommandContext {
  /** Null only for createChat and clearSuggestionLearning. */
  chatGuid: string | null;
  row: OutboxRow;
  commands: ChatCommands;
  writer: MessageWriter;
  signal: AbortSignal;
  /** Starts periodic renewal, also for a handler that opts in dynamically. */
  withLeaseRenewal<T>(work: () => Promise<T>): Promise<T>;
}
export interface CommandHandler<K extends CommandKind> {
  longRunning?: boolean;
  execute(context: CommandContext, payload: Extract<CommaOutboxPayload, { kind: K }>): Promise<ResultFor<K>>;
}
export type HandlerMap = { [K in CommandKind]: CommandHandler<K> };

export function requireChat(context: CommandContext): string {
  if (!context.chatGuid) throw new Error("Command requires a conversation");
  return context.chatGuid;
}
export function accept(result: { ok: boolean; error?: string }): void {
  if (!result.ok) throw new Error(result.error ?? "BlueBubbles operation failed");
}
export function notImplemented<K extends CommandKind>(longRunning = false): CommandHandler<K> {
  return { longRunning, execute: async () => { throw new Error("not implemented"); } };
}
