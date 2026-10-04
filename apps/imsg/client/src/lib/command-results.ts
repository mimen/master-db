import type { GenericId } from "convex/values";
import type { CommandReceipt as WireReceipt, CommandResult as WireResult } from "../../../../../convex/schema/comma/validators";

export type CommandResult = WireResult;
export type CommandReceipt = WireReceipt;
export type ResultFor<K extends CommandResult["kind"]> = Extract<CommandResult, { kind: K }>;

export class CommandExecutionError extends Error {
  constructor(message: string, readonly commandId: GenericId<"comma_outbox">, readonly clientKey: string) {
    super(message);
    this.name = "CommandExecutionError";
  }
}
/** The operation may have happened. Callers must not offer an automatic retry. */
export class UnknownCommandError extends CommandExecutionError {
  constructor(receipt: CommandReceipt) {
    super(receipt.error ?? "Command outcome is unknown", receipt.commandId, receipt.clientKey);
    this.name = "UnknownCommandError";
  }
}
export class CommandResultError extends CommandExecutionError {
  constructor(message: string, receipt: CommandReceipt) {
    super(message, receipt.commandId, receipt.clientKey);
    this.name = "CommandResultError";
  }
}

/** Pending/claimed return undefined. Every terminal receipt resolves or throws. */
export function resultFromReceipt<K extends CommandResult["kind"]>(receipt: CommandReceipt, kind: K): ResultFor<K> | undefined {
  if (receipt.status === "failed") throw new CommandExecutionError(receipt.error ?? "Command failed", receipt.commandId, receipt.clientKey);
  if (receipt.status === "unknown") throw new UnknownCommandError(receipt);
  if (receipt.status !== "sent") return undefined;
  if (!receipt.result) throw new CommandResultError("Completed command has no result", receipt);
  if (receipt.result.kind !== kind) throw new CommandResultError("Command result kind does not match request", receipt);
  return receipt.result as ResultFor<K>;
}
