import { useCallback, useEffect, useRef, useState } from "react";
import type { FunctionArgs } from "convex/server";
import type { GenericId } from "convex/values";
import { commaApi, commaOutbox } from "./convex-api";
import { resultFromReceipt, type CommandReceipt, type CommandResult, type ResultFor } from "./command-results";

export type CommandPayload = FunctionArgs<typeof commaOutbox.enqueue>["payload"];

/** Injected client contracts keep the complete test suite free of module mocks. */
export interface CommandClient {
  query(ref: typeof commaApi.resolveChat, args: { chatGuid: string }): Promise<{ _id: string } | null>;
  mutation(ref: typeof commaOutbox.enqueue, args: FunctionArgs<typeof commaOutbox.enqueue>): Promise<unknown>;
}
export interface CommandWatch {
  onUpdate(callback: () => void): () => void;
  localQueryResult(): CommandReceipt | null | undefined;
}
export interface ResultCommandClient extends CommandClient {
  watchQuery(ref: typeof commaOutbox.getCommand, args: { commandId: GenericId<"comma_outbox"> }): CommandWatch;
}
export interface RunCommandOptions {
  /** Reuse only for retries of the same logical command. */
  clientKey?: string;
  /** Cancels observation, not the queued operation. */
  signal?: AbortSignal;
}

function newClientKey(): string {
  return `command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
async function enqueueCommandVia(client: CommandClient, chatGuid: string | null, payload: CommandPayload, clientKey = newClientKey()): Promise<GenericId<"comma_outbox">> {
  const global = payload.kind === "createChat" || payload.kind === "clearSuggestionLearning";
  if (!chatGuid && !global) throw new Error("This command requires a chat");
  const conversation = chatGuid ? await client.query(commaApi.resolveChat, { chatGuid }) : null;
  if (chatGuid && !conversation) throw new Error("Conversation is not mirrored yet");
  const id = await client.mutation(commaOutbox.enqueue, {
    clientKey,
    ...(conversation ? { conversationId: conversation._id as GenericId<"comma_conversations"> } : {}),
    payload,
  });
  if (typeof id !== "string") throw new Error("Enqueue did not return a command ID");
  return id as GenericId<"comma_outbox">;
}

/** Existing immediate-queue API. Callers migrate to runCommand in phase 3. */
export async function enqueueVia(client: CommandClient, chatGuid: string, payload: CommandPayload): Promise<void> {
  await enqueueCommandVia(client, chatGuid, payload);
}

export async function runCommandVia<P extends CommandPayload>(client: ResultCommandClient, chatGuid: string | null, payload: P, options: RunCommandOptions = {}): Promise<ResultFor<P["kind"]>> {
  options.signal?.throwIfAborted();
  const commandId = await enqueueCommandVia(client, chatGuid, payload, options.clientKey);
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const cleanup = () => {
      unsubscribe?.();
      options.signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const abort = () => fail(options.signal?.reason ?? new Error("Command observation canceled"));
    try {
      const watch = client.watchQuery(commaOutbox.getCommand, { commandId });
      const read = () => {
        if (settled) return;
        try {
          const receipt = watch.localQueryResult();
          if (receipt === undefined) return;
          if (receipt === null) throw new Error("Command not found");
          const result = resultFromReceipt<P["kind"]>(receipt, payload.kind);
          if (result === undefined) return;
          settled = true; cleanup(); resolve(result);
        } catch (error) { fail(error); }
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      unsubscribe = watch.onUpdate(read);
      if (settled) cleanup();
      else if (options.signal?.aborted) abort();
      else read(); // Already-cached terminal results need no new server update.
    } catch (error) { fail(error); }
  });
}

/** Uses the authenticated client shared with the rest of imsg. Import only on invocation. */
export async function runCommand<P extends CommandPayload>(chatGuid: string | null, payload: P, options?: RunCommandOptions): Promise<ResultFor<P["kind"]>> {
  const { convexClient } = await import("./identity");
  return runCommandVia(convexClient, chatGuid, payload, options);
}

export function useRunCommand(client?: ResultCommandClient) {
  const [pendingCount, setPendingCount] = useState(0);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);
  const sequence = useRef(0);
  const observers = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const active = observers.current;
    return () => {
      mounted.current = false;
      for (const controller of active) controller.abort(new Error("Command observation canceled on unmount"));
      active.clear();
    };
  }, []);
  const run = useCallback(async <P extends CommandPayload>(chatGuid: string | null, payload: P, options?: RunCommandOptions): Promise<ResultFor<P["kind"]>> => {
    const current = ++sequence.current;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options?.signal?.reason);
    if (options?.signal?.aborted) forwardAbort();
    else options?.signal?.addEventListener("abort", forwardAbort, { once: true });
    observers.current.add(controller);
    const observation = { ...options, signal: controller.signal };
    setPendingCount((count) => count + 1);
    setError(null); setResult(null);
    try {
      const value = await (client ? runCommandVia(client, chatGuid, payload, observation) : runCommand(chatGuid, payload, observation));
      if (mounted.current && sequence.current === current) setResult(value);
      return value;
    } catch (cause) {
      if (mounted.current && sequence.current === current) setError(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    } finally {
      observers.current.delete(controller);
      options?.signal?.removeEventListener("abort", forwardAbort);
      if (mounted.current) setPendingCount((count) => count - 1);
    }
  }, [client]);
  return { runCommand: run, isPending: pendingCount > 0, result, error };
}
