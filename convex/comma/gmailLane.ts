import { v, type Infer } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type ActionCtx, type MutationCtx } from "../_generated/server";
import { gmailMessageValue, type CommandResult, type CommaRoute } from "../schema/comma/validators";

import { gmail } from "./conversationIdentity";
import { EMAIL_FILES_LIMIT, MAX_EMAIL_FILES_BYTES } from "./enqueue";
import { findByKey } from "./conversationLookup";
import { GMAIL_API, GMAIL_UPLOAD, googleApi, GoogleApiError } from "./gmailApi";
import { parseAddresses, parseGmailMessage, type EmailAddress, type RawGmailMessage } from "./gmailMessage";
import { gmailAccount, insertGmailMessages, writeGmailThread } from "./gmailSync";
import { gmailToken } from "./googleAuth";
import { NotSentError } from "./laneRegistry";
import { completePendingSend } from "./pendingSends";
import { settleConversation, unsettleConversation } from "./triage";

/**
 * The Gmail lane: Convex runs each command against the Gmail API as Milad (laneRegistry.ts). A send goes out as an RFC
 * 822 message whose In-Reply-To, References and threadId thread it in Gmail, and whose Message-ID is built from the
 * send's clientKey. Files from storage go out as multipart/mixed through the upload endpoint. `sendEmail` starts a new
 * thread (a new email or a forward), and its message lands as a new conversation. The sent message lands from Gmail's
 * answer in applyGmailResult. A send whose outcome is unknown is looked for by that Message-ID, never sent again.
 * Archive and unarchive are Comma's settle and unsettle written back.
 */

type OutboxRow = Doc<"comma_outbox">;
type GmailRoute = Extract<CommaRoute, { platform: "gmail" }>;
type GmailMessageValue = Infer<typeof gmailMessageValue>;
type SendKind = Extract<OutboxRow["payload"], { kind: "send" | "sendEmail" }>;
type Header = { name: string; value: string };
type RawThread = { messages?: (RawGmailMessage & { payload?: { headers?: Header[] } })[] };

/** Gmail's own cap on what one email's files add up to. */

/** Waits before each retry of a rate-limited request. A backfill can hold the mailbox's per-user quota for a while. */
const RATE_LIMIT_WAITS_MS = [2_000, 5_000, 10_000];

/**
 * A 4xx (a 429 included) is Google turning the request away. A 5xx or a lost answer may come after Gmail acted.
 * A rate limit is also a refusal, so it is safe to try again; the send fails only if the limit outlasts the waits.
 */
async function call<T>(url: string, init: Parameters<typeof googleApi>[1]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await googleApi<T>(url, init);
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.status < 500)) throw error;
      const wait = error.rateLimited ? RATE_LIMIT_WAITS_MS[attempt] : undefined;
      if (wait === undefined) throw new NotSentError(error.message);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** The Message-ID a send carries, so a send whose answer was lost can be found in Sent. */
export function messageIdOf(clientKey: string, address: string): string {
  return `<comma.${clientKey.replace(/[^A-Za-z0-9._-]/g, "-")}@${address.split("@")[1] ?? "comma.invalid"}>`;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const utf8 = (text: string) => new TextEncoder().encode(text);
const base64url = (text: string) => base64(utf8(text)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A header value with no line breaks, so no header can be smuggled in; on the wire, in RFC 2047 form when it is not ASCII. */
function headerText(text: string, wire: boolean): string {
  const flat = text.replace(/[\r\n]+/g, " ").trim();
  return !wire || /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${base64(utf8(flat))}?=`;
}
function addressHeader(addresses: readonly EmailAddress[], wire: boolean): string {
  return addresses.map(({ address, name }) => {
    if (!name) return address;
    const display = headerText(name, wire);
    return display.startsWith("=?") ? `${display} <${address}>` : `"${display.replace(/["\\]/g, "\\$&")}" <${address}>`;
  }).join(", ");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The simple HTML part beside the plain text: the same words, each line kept. */
export const htmlBody = (text: string) => `<div dir="ltr">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;

export type OutgoingFile = { filename: string; mimeType: string; bytes: Uint8Array };

export type OutgoingEmail = {
  from: EmailAddress; to: EmailAddress[]; cc: EmailAddress[]; subject: string; text: string;
  messageId: string; inReplyTo?: string; references?: string; date: Date; files?: OutgoingFile[];
};

/** The headers a sent email carries: encoded on the wire, and decoded, as Gmail reads them back, on the message Comma lands. */
function emailHeaders(email: OutgoingEmail, wire: boolean): Header[] {
  return [
    { name: "From", value: addressHeader([email.from], wire) },
    { name: "To", value: addressHeader(email.to, wire) },
    ...(email.cc.length ? [{ name: "Cc", value: addressHeader(email.cc, wire) }] : []),
    { name: "Subject", value: headerText(email.subject, wire) },
    { name: "Date", value: email.date.toUTCString() },
    { name: "Message-ID", value: email.messageId },
    ...(email.inReplyTo ? [{ name: "In-Reply-To", value: email.inReplyTo }] : []),
    ...(email.references ? [{ name: "References", value: email.references }] : []),
  ];
}

const wrap = (bytes: Uint8Array) => base64(bytes).replace(/.{76}/g, "$&\r\n");
/** A filename as a quoted parameter, in RFC 2231 form as well when it is not ASCII. */
function filenameParams(name: string): string {
  const flat = name.replace(/[\r\n"\\]+/g, " ").trim() || "attachment";
  return /^[\x20-\x7e]*$/.test(flat) ? `filename="${flat}"` : `filename="${headerText(flat, true)}"; filename*=UTF-8''${encodeURIComponent(flat)}`;
}

/**
 * The whole message as users.messages.send takes it: plain text and its HTML part, each base64 in UTF-8, and with
 * files, those two inside multipart/mixed, each file a base64 attachment part after them.
 */
export function rfc822(email: OutgoingEmail): string {
  const boundary = `comma-${email.messageId.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}`;
  const part = (type: string, body: string) => [
    `--${boundary}`, `Content-Type: ${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", wrap(utf8(body)),
  ].join("\r\n");
  const alternative = [`Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    part("text/plain", email.text), part("text/html", htmlBody(email.text)), `--${boundary}--`, ""].join("\r\n");
  const headers = [...emailHeaders(email, true).map((header) => `${header.name}: ${header.value}`), "MIME-Version: 1.0"];
  if (!email.files?.length) return [...headers, alternative].join("\r\n");
  const mixed = `${boundary}-mixed`;
  return [
    ...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, alternative,
    ...email.files.flatMap((file) => [
      `--${mixed}`, `Content-Type: ${file.mimeType.replace(/[\r\n;"]/g, "") || "application/octet-stream"}; ${filenameParams(file.filename).replace("filename", "name")}`,
      `Content-Disposition: attachment; ${filenameParams(file.filename)}`, "Content-Transfer-Encoding: base64", "", wrap(file.bytes),
    ]),
    `--${mixed}--`, "",
  ].join("\r\n");
}

/**
 * The message Comma sent, as a read of it would parse, so it lands as its echo will. Its files are the stored ones it
 * was built from, numbered as Gmail numbers the parts after the text.
 */
function sentMessage(email: OutgoingEmail, sent: { id: string; threadId: string; labelIds?: string[] }, files: readonly Stored[]): GmailMessageValue {
  const parsed = parseGmailMessage({
    id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds ?? ["SENT"], internalDate: String(email.date.getTime()),
    snippet: email.text.slice(0, 200),
    payload: { mimeType: "multipart/alternative", headers: emailHeaders(email, false), parts: [
      { mimeType: "text/plain", body: { data: base64url(email.text) } },
      { mimeType: "text/html", body: { data: base64url(htmlBody(email.text)) } },
    ] },
  });
  // A message Milad wrote is never bulk mail, whatever his address looks like.
  return { ...parsed, bulk: false, text: email.text, attachments: files.map((file, index) => ({
    partId: String(index + 1), filename: file.filename, mimeType: file.mimeType, size: file.bytes.length, inline: false, storageId: file.storageId,
  })) };
}

type Stored = OutgoingFile & { storageId: Id<"_storage"> };

/** The payload's files, read from storage. Nothing has been sent yet, so a missing file or a total over Gmail's cap fails the send. */
async function storedFiles(ctx: ActionCtx, payload: SendKind): Promise<Stored[]> {
  const files: Stored[] = [];
  let total = 0;
  for (const attachment of payload.email?.attachments ?? []) {
    const blob = await ctx.storage.get(attachment.storageId);
    if (!blob) throw new NotSentError(`${attachment.filename} is no longer stored`);
    total += blob.size;
    if (total > MAX_EMAIL_FILES_BYTES) throw new NotSentError(EMAIL_FILES_LIMIT);
    files.push({ ...attachment, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  return files;
}

/** users.messages.send: the JSON form for text alone, the upload endpoint for a message carrying files, which can be large. */
async function deliver(raw: string, threadId: string | undefined, token: string, upload: boolean) {
  type Sent = { id: string; threadId: string; labelIds?: string[] };
  if (!upload) return await call<Sent>(`${GMAIL_API}/messages/send`, { token, json: { raw: base64url(raw), ...(threadId ? { threadId } : {}) } });
  const boundary = `comma-upload-${crypto.randomUUID()}`;
  const body = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(threadId ? { threadId } : {}),
    `--${boundary}`, "Content-Type: message/rfc822", "", raw, `--${boundary}--`, ""].join("\r\n");
  return await call<Sent>(`${GMAIL_UPLOAD}/messages/send?uploadType=multipart`, { token, raw: { contentType: `multipart/related; boundary=${boundary}`, body } });
}

const headerOf = (headers: readonly Header[] | undefined, name: string) =>
  headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value.trim();

/** The message a reply answers (the one it names, else the thread's newest), and the threading headers it gives the reply. */
async function threading(token: string, threadId: string, replyToGuid: string | undefined) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const header of ["Message-ID", "References"]) params.append("metadataHeaders", header);
  // Nothing has been sent yet, so a failed read fails the send.
  const thread = await googleApi<RawThread>(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}?${params}`, { token }).catch((error: unknown) => {
    throw new NotSentError(error instanceof Error ? error.message : String(error));
  });
  const messages = (thread.messages ?? []).filter((message) => !message.labelIds?.includes("DRAFT"));
  const parent = messages.find((message) => message.id === replyToGuid) ?? messages[messages.length - 1];
  const parentId = headerOf(parent?.payload?.headers, "Message-ID");
  if (!parentId) return {};
  const references = [headerOf(parent?.payload?.headers, "References"), parentId].filter(Boolean).join(" ");
  return { inReplyTo: parentId, references };
}

/** A reply into `threadId`, or with none, the first message of a new thread. */
async function sendEmail(ctx: ActionCtx, row: OutboxRow, accountId: Id<"comma_accounts">, threadId: string | undefined, token: string): Promise<CommandResult> {
  const { payload } = row;
  if ((payload.kind !== "send" && payload.kind !== "sendEmail") || !payload.email) throw new NotSentError("An email needs someone to send it to");
  const [address] = await ctx.runQuery(internal.comma.gmailSync.selfHandles, { accountId });
  if (!address) throw new NotSentError("Gmail is not connected");
  const to = parseAddresses(payload.email.to.join(", "));
  const cc = parseAddresses(payload.email.cc.join(", "));
  if (!to.length && !cc.length) throw new NotSentError("An email needs someone to send it to");
  const sendAs = await googleApi<{ sendAs?: { sendAsEmail: string; displayName?: string }[] }>(`${GMAIL_API}/settings/sendAs`, { token })
    .catch(() => ({ sendAs: [] }));
  const name = sendAs.sendAs?.find((alias) => alias.sendAsEmail.toLowerCase() === address)?.displayName || null;
  // ponytail: always sends from the mailbox's own address; a reply to mail sent to an alias should send from that alias.
  const files = await storedFiles(ctx, payload);
  const email: OutgoingEmail = {
    from: { address, name }, to, cc, subject: payload.email.subject, text: payload.text, files,
    messageId: messageIdOf(row.clientKey, address), date: new Date(),
    ...threadId && payload.kind === "send" ? await threading(token, threadId, payload.replyToGuid) : {},
  };
  const sent = await deliver(rfc822(email), threadId, token, files.length > 0);
  if (!sent.id || !(sent.threadId || threadId)) throw new Error("Gmail confirmed the send without its id");
  const gmail = sentMessage(email, { ...sent, threadId: sent.threadId || threadId! }, files);
  return payload.kind === "send" ? { kind: "send", guid: sent.id, gmail } : { kind: "sendEmail", guid: sent.id, gmail };
}

export async function executeGmail(ctx: ActionCtx, row: OutboxRow): Promise<CommandResult> {
  const { route, payload } = row;
  const gmailRoute = route?.platform === "gmail" ? route : undefined;
  const accountId = payload.kind === "sendEmail" ? payload.accountId : gmailRoute?.accountId;
  if (!accountId) throw new NotSentError("Not a Gmail command");
  if (payload.kind === "markRead") return { kind: "markRead", ok: true };
  const token = await gmailToken(ctx, accountId).catch(() => null);
  if (!token) throw new NotSentError("Gmail is not connected");
  if (payload.kind === "sendEmail") return await sendEmail(ctx, row, accountId, undefined, token);
  if (!gmailRoute) throw new NotSentError("Not a Gmail command");
  switch (payload.kind) {
    case "send":
      return await sendEmail(ctx, row, gmailRoute.accountId, gmailRoute.threadId, token);
    case "archive":
    case "unarchive": {
      const labels = { [payload.kind === "archive" ? "removeLabelIds" : "addLabelIds"]: ["INBOX"] };
      // Moving a label twice changes nothing, so any error fails the row and Comma takes its settle back.
      await googleApi(`${GMAIL_API}/threads/${encodeURIComponent(gmailRoute.threadId)}/modify`, { token, json: labels })
        .catch((error: unknown) => {
          throw new NotSentError(error instanceof Error ? error.message : String(error));
        });
      return { kind: payload.kind, ok: true };
    }
    default:
      throw new NotSentError(`Gmail can't run ${payload.kind}`);
  }
}

/** A sent message, written as the thread's next read would write it. Replying lifts a thread out of bulk mail. */
async function landGmailSend(ctx: MutationCtx, accountId: Id<"comma_accounts">, conversationId: Id<"comma_conversations">, message: GmailMessageValue, clientKey: string) {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return;
  await insertGmailMessages(ctx, await gmailAccount(ctx, accountId), conversationId, [message], clientKey);
  if (conversation.gmail?.bulk) await ctx.db.patch(conversationId, { gmail: { ...conversation.gmail, bulk: false } });
}

/** Where a thread's inbox state now stands, so the echo from Gmail's history finds nothing to change. */
async function setInbox(ctx: MutationCtx, conversationId: Id<"comma_conversations">, inInbox: boolean, archiveError?: string) {
  const conversation = await ctx.db.get(conversationId);
  if (conversation?.gmail) await ctx.db.patch(conversationId, { gmail: { ...conversation.gmail, inInbox, archiveError } });
}

/** What a confirmed Gmail command changes in Convex, before Gmail's history says so. A new thread's row learns its conversation. */
export async function applyGmailResult(ctx: MutationCtx, row: OutboxRow): Promise<void> {
  const { route, payload, conversationId, result } = row;
  if (payload.kind === "sendEmail" && result?.kind === "sendEmail") {
    await writeGmailThread(ctx, payload.accountId, result.gmail.threadId, [result.gmail], true);
    const thread = await findByKey(ctx, { platform: "gmail", accountId: payload.accountId }, gmail.conversationKey(result.gmail.threadId));
    if (thread) await ctx.db.patch(row._id, { conversationId: thread._id });
    return;
  }
  if (route?.platform !== "gmail" || !conversationId) return;
  if (payload.kind === "send" && result?.kind === "send" && "gmail" in result) await landGmailSend(ctx, route.accountId, conversationId, result.gmail, row.clientKey);
  if (payload.kind === "archive" || payload.kind === "unarchive") await setInbox(ctx, conversationId, payload.kind === "unarchive");
}

/** Gmail is the source of truth, so a refused archive takes Comma's settle back, and a refused unarchive settles again. */
export async function applyGmailFailure(ctx: MutationCtx, row: OutboxRow): Promise<void> {
  const { payload, conversationId } = row;
  if (!conversationId || (payload.kind !== "archive" && payload.kind !== "unarchive")) return;
  const conversation = await ctx.db.get(conversationId);
  if (!conversation?.gmail || !conversation.lastMessage) return;
  const source = { by: "mailbox", quiet: true } as const;
  if (payload.kind === "archive") await unsettleConversation(ctx, conversationId, source);
  else await settleConversation(ctx, conversationId, undefined, source);
  await setInbox(ctx, conversationId, conversation.gmail.inInbox, `Gmail didn't ${payload.kind} this: ${row.error ?? "it refused"}`);
}

// ---- Unknown sends: looked for in Gmail at 20 seconds and again at 2 minutes, never sent again. ----

const FIRST_CHECK_MS = 20_000;
const LAST_CHECK_MS = 2 * 60_000;
/** How far before its enqueue a sent message may be dated, for clock skew between Convex and Gmail. */
const SKEW_MS = 60_000;

/** Schedules the check for a Gmail send that ended unknown. Every other row passes through. */
export async function checkUnknownGmailSend(ctx: MutationCtx, row: OutboxRow): Promise<void> {
  if (row.lane !== "gmail" || row.payload.kind !== "send") return;
  await ctx.scheduler.runAfter(FIRST_CHECK_MS, internal.comma.gmailLane.findSend, { clientKey: row.clientKey, last: false });
}

const readFull = async <T>(token: string, path: string) => await googleApi<T>(`${GMAIL_API}/${path}?format=full`, { token });

/** Sent messages that could be the send: its own Message-ID first, then one in the thread with the same subject and text. */
async function candidates(ctx: ActionCtx, row: OutboxRow, route: GmailRoute): Promise<GmailMessageValue[]> {
  if (row.payload.kind !== "send") return [];
  const token = await gmailToken(ctx, route.accountId);
  const [address] = await ctx.runQuery(internal.comma.gmailSync.selfHandles, { accountId: route.accountId });
  if (!token || !address) return [];
  const q = `rfc822msgid:${messageIdOf(row.clientKey, address).slice(1, -1)}`;
  const listed = await googleApi<{ messages?: { id: string }[] }>(`${GMAIL_API}/messages?${new URLSearchParams({ q })}`, { token });
  const byId = await Promise.all((listed.messages ?? []).map(async ({ id }) => parseGmailMessage(await readFull<RawGmailMessage>(token, `messages/${encodeURIComponent(id)}`))));
  if (byId.length) return byId.map((message) => ({ ...message, bulk: false }));
  const { text, email } = row.payload;
  const thread = (await readFull<RawThread>(token, `threads/${encodeURIComponent(route.threadId)}`)).messages ?? [];
  return thread.map(parseGmailMessage).filter((message) => message.labelIds.includes("SENT") && message.internalDate >= row.createdAt - SKEW_MS &&
    message.subject === email?.subject.trim() && message.text.trim() === text.trim())
    .sort((a, b) => a.internalDate - b.internalDate).map((message) => ({ ...message, bulk: false }));
}

export const findSend = internalAction({
  args: { clientKey: v.string(), last: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { clientKey, last }) => {
    const row = await ctx.runQuery(internal.comma.outbox.unknownSend, { clientKey });
    if (row?.route?.platform !== "gmail" || row.payload.kind !== "send") return null;
    let found: GmailMessageValue[] = [];
    try {
      found = await candidates(ctx, row, row.route);
    } catch {
      // Gmail could not be read this time; the next check reads again, and after the last the send stays unknown.
    }
    const landed = found.length > 0 && await ctx.runMutation(internal.comma.gmailLane.landFoundSend, { clientKey, candidates: found });
    if (!landed && !last) await ctx.scheduler.runAfter(LAST_CHECK_MS - FIRST_CHECK_MS, internal.comma.gmailLane.findSend, { clientKey, last: true });
    return null;
  },
});

/** The first candidate no other send already owns becomes this send's message, and the send is sent. */
export const landFoundSend = internalMutation({
  args: { clientKey: v.string(), candidates: v.array(gmailMessageValue) },
  returns: v.boolean(),
  handler: async (ctx, { clientKey, candidates: found }) => {
    const row = await ctx.db.query("comma_outbox").withIndex("by_clientKey", (q) => q.eq("clientKey", clientKey)).unique();
    if (row?.status !== "unknown" || row.route?.platform !== "gmail" || !row.conversationId) return false;
    for (const message of found) {
      const owner = await ctx.db.query("comma_outbox").withIndex("by_resultGuid", (q) => q.eq("resultGuid", message.id)).first();
      if (owner && owner.clientKey !== clientKey) continue;
      await ctx.db.patch(row._id, { status: "sent", error: undefined, resultGuid: message.id, result: { kind: "send", guid: message.id, gmail: message }, updatedAt: Date.now() });
      await landGmailSend(ctx, row.route.accountId, row.conversationId, message, clientKey);
      await completePendingSend(ctx, clientKey, "sent", message.id);
      return true;
    }
    return false;
  },
});
