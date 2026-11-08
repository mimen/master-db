import { expect, test } from "bun:test";
import type { GenericId } from "convex/values";
import { fromBridgeMessage } from "@shared/imessage";
import type { ConversationId } from "@shared/types";
import type { CommandReceipt, CommandResult } from "./command-results";
import { UnknownCommandError } from "./command-results";
import { runCommandVia, type ResultCommandClient, type CommandPayload } from "./convex-commands";
import { createMessagingApi, messagingCommandError } from "./messaging-api";

const message = { guid: "message", chatGuid: "chat", text: "sent", dateCreated: 1, dateRead: null, dateDelivered: null,
  isFromMe: true, service: "iMessage" as const, sender: null, attachments: [], mentions: [], special: null,
  sendEffect: null, reactions: [], replyToGuid: null, replyToPreview: null, replyToFromMe: null, isGroupEvent: false,
  error: 0, edited: false, retracted: false };
const conv = "conv-1" as ConversationId;
const chat = { conversationId: conv, route: { platform: "imessage" as const, accountId: null, imessage: { chatGuid: "iMessage;-;+15550001111" } } };
function harness(status: CommandReceipt["status"] = "sent") {
  const calls: Array<{ conversationId?: string; clientKey: string; payload: CommandPayload }> = [];
  let receipt: CommandReceipt;
  let callback: (() => void) | undefined;
  const client: ResultCommandClient = {
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
  const api = createMessagingApi((conversationId, payload, options) => runCommandVia(client, conversationId, payload, options));
  return { api, calls, finish: () => { receipt.status = "sent"; callback?.(); } };
}

test("send returns the message and preserves mentions and reply part", async () => {
  const h = harness();
  const body = { text: "Hi Alex", replyToGuid: "reply", replyToPart: 2, mentions: [{ start: 3, length: 4, address: "recipient" }] };
  expect(await h.api.sendText(conv, body, { clientKey: "temp-composer" })).toEqual(fromBridgeMessage(message));
  expect(h.calls[0]?.conversationId).toBe("conv-1");
  expect(h.calls[0]?.clientKey).toBe("temp-composer");
  expect(h.calls[0]?.payload).toEqual({ kind: "send", ...body });
});

test("contact, FaceTime and group adapters preserve their public result shapes", async () => {
  const h = harness();
  expect(await h.api.sendContactCard(conv, { name: "Alex", address: "recipient" }, "caption")).toEqual(fromBridgeMessage(message));
  expect(h.calls[0]?.payload).toEqual({ kind: "sendContact", name: "Alex", address: "recipient", caption: "caption" });
  expect(await h.api.createFaceTimeLink(conv)).toEqual({ message: fromBridgeMessage(message) });
  expect(await h.api.participant(conv, "person", "remove")).toMatchObject({ ok: true });
  expect(await h.api.leaveGroup(conv)).toMatchObject({ ok: true });
  expect(await h.api.deleteChat(chat)).toMatchObject({ ok: true });
  expect(h.calls.at(-1)?.payload).toEqual({ kind: "deleteChat", chatGuid: "iMessage;-;+15550001111" });
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
    const operations = [() => h.api.sendText(conv, { text: "hi" }),
      () => h.api.sendContactCard(conv, { name: "Alex", address: "recipient" }),
      () => h.api.createFaceTimeLink(conv), () => h.api.newChat({ addresses: ["recipient"], text: "hi" }),
      () => h.api.participant(conv, "recipient", "add"), () => h.api.leaveGroup(conv), () => h.api.deleteChat(chat)];
    for (const operation of operations) {
      try { await operation(); succeeded = true; }
      catch (error) {
        expect(messagingCommandError(error, "Existing failure toast")).toBe(status === "unknown"
          ? "Not sure this went through. Check the conversation before trying again." : "Existing failure toast");
        if (status === "unknown") expect(error).toBeInstanceOf(UnknownCommandError);
      }
    }
    expect(succeeded).toBe(false);
  }
});
