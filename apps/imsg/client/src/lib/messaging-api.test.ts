import { expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import type { CommandReceipt, CommandResult } from "./command-results";
import { UnknownCommandError } from "./command-results";
import { runCommandVia, type ResultCommandClient, type CommandPayload } from "./convex-commands";
import { createMessagingApi, enqueueTextSendVia, messagingCommandError } from "./messaging-api";

const message = { guid: "message", chatGuid: "chat", text: "sent", dateCreated: 1, dateRead: null, dateDelivered: null,
  isFromMe: true, service: "iMessage" as const, sender: null, attachments: [], mentions: [], special: null,
  sendEffect: null, reactions: [], replyToGuid: null, replyToPreview: null, replyToFromMe: null, isGroupEvent: false,
  error: 0, edited: false, retracted: false };
function harness(status: CommandReceipt["status"] = "sent") {
  const calls: Array<{ conversationId?: string; payload: CommandPayload }> = [];
  let receipt: CommandReceipt;
  let callback: (() => void) | undefined;
  const client: ResultCommandClient = {
    query: async () => ({ _id: "conversation" }),
    mutation: async (_ref, args) => {
      calls.push(args);
      const kind = args.payload.kind;
      const result: CommandResult = kind === "createChat" ? { kind, chatGuid: "new-chat", service: "iMessage", isGroup: false, participants: ["recipient"], message }
        : ["send", "sendContact", "createFaceTimeLink"].includes(kind) ? { kind, message } as CommandResult
        : { kind, ok: true } as CommandResult;
      receipt = { commandId: "command" as GenericId<"comma_outbox">, clientKey: "key", status, updatedAt: 1, result,
        ...(status === "unknown" ? { error: "socket closed" } : status === "failed" ? { error: "rejected" } : {}) };
      return "command";
    },
    watchQuery: () => ({ localQueryResult: () => receipt, onUpdate: (listener) => { callback = listener; return () => { callback = undefined; }; } }),
  };
  const api = createMessagingApi((chatGuid, payload, options) => runCommandVia(client, chatGuid, payload, options));
  return { api, calls, finish: () => { receipt.status = "sent"; callback?.(); } };
}

test("send returns the message and preserves mentions and reply part", async () => {
  const h = harness();
  const body = { text: "Hi Alex", replyToGuid: "reply", replyToPart: 2, mentions: [{ start: 3, length: 4, address: "recipient" }] };
  expect(await h.api.sendText("chat", body)).toEqual(message);
  expect(h.calls[0]?.payload).toEqual({ kind: "send", ...body });
});

test("contact, FaceTime and group adapters preserve their public result shapes", async () => {
  const h = harness();
  expect(await h.api.sendContactCard("chat", { name: "Alex", address: "recipient" }, "caption")).toEqual(message);
  expect(h.calls[0]?.payload).toEqual({ kind: "sendContact", name: "Alex", address: "recipient", caption: "caption" });
  expect(await h.api.createFaceTimeLink("chat")).toEqual({ message });
  expect(await h.api.participant("chat", "person", "remove")).toMatchObject({ ok: true });
  expect(await h.api.leaveGroup("chat")).toMatchObject({ ok: true });
  expect(await h.api.deleteChat("chat")).toMatchObject({ ok: true });
  expect(h.calls.at(-1)?.payload).toEqual({ kind: "deleteChat", chatGuid: "chat" });
});

test("newChat queues globally and returns the navigation guid only after the receipt completes", async () => {
  const h = harness("claimed");
  let navigated: string | undefined;
  const pending = h.api.newChat({ addresses: ["recipient"], text: "hi" }).then((result) => { navigated = result.chatGuid; return result; });
  await Bun.sleep(0);
  expect(navigated).toBeUndefined();
  expect(h.calls[0]?.conversationId).toBeUndefined();
  expect(h.calls[0]?.payload).toEqual({ kind: "createChat", addresses: ["recipient"], text: "hi" });
  h.finish();
  expect(await pending).toMatchObject({ chatGuid: "new-chat", service: "iMessage", message });
  expect(navigated).toBe("new-chat");
});

test("failed and unknown results never acknowledge a send, navigate, or report success", async () => {
  for (const status of ["failed", "unknown"] as const) {
    const h = harness(status);
    let succeeded = false;
    const operations = [() => h.api.sendText("chat", { text: "hi" }),
      () => h.api.sendContactCard("chat", { name: "Alex", address: "recipient" }),
      () => h.api.createFaceTimeLink("chat"), () => h.api.newChat({ addresses: ["recipient"], text: "hi" }),
      () => h.api.participant("chat", "recipient", "add"), () => h.api.leaveGroup("chat"), () => h.api.deleteChat("chat")];
    for (const operation of operations) {
      try { await operation(); succeeded = true; }
      catch (error) {
        expect(messagingCommandError(error, "Existing failure toast")).toBe(status === "unknown"
          ? "Command outcome unknown. Check the conversation before trying again." : "Existing failure toast");
        if (status === "unknown") expect(error).toBeInstanceOf(UnknownCommandError);
      }
    }
    expect(succeeded).toBe(false);
  }
});

test("the immediate queue accepts mentions and preserves the supplied client key and reply part", async () => {
  let queued: unknown;
  const client: ResultCommandClient = {
    query: async () => ({ _id: "conversation" }),
    mutation: async (_ref, args) => { queued = args; return "command"; },
    watchQuery: () => { throw new Error("must not wait for a receipt"); },
  };
  const body = { text: "Hi Alex", replyToGuid: "reply", replyToPart: 2, mentions: [{ start: 3, length: 4, address: "recipient" }] };
  expect(await enqueueTextSendVia(client, "chat", "original-key", body)).toBe(true);
  expect(queued).toEqual({ clientKey: "original-key", conversationId: "conversation", payload: { kind: "send", ...body } });
  client.query = async () => null;
  await expect(enqueueTextSendVia(client, "missing", "key", body)).rejects.toThrow("not mirrored");
});
