import type { BBAttributedBody } from "./bb-types";
import type { BlueBubbles, Result } from "./bluebubbles";
import type { ChatDirectory } from "./chat-directory";
import type { MentionAnnotation } from "../shared/mentions";
import { buildThread, mapMessage } from "./map";
import { buildMentionAttributedBody } from "./mention-body";
import { createdChatError, messageBelongsToAnyChat, outboundAddressesError, outboundTextError } from "./message-verification";
import { createAndSendFaceTimeLink } from "./facetime";
import type { NameSource } from "./name-resolver";

type CommandResult<T> = { ok: true; value: T } | { ok: false; error: string; status: 400 | 501 | 502 };
function failure(error: string, status: 400 | 501 | 502 = 502): CommandResult<never> {
  return { ok: false, error, status };
}
function checked<T>(result: Result<T>): CommandResult<T> {
  return result.ok ? result : failure(result.error);
}

export class UnknownSendError extends Error {}

export class ChatCommands {
  constructor(readonly bb: BlueBubbles, readonly directory: ChatDirectory, private names: NameSource,
    private scheduledChanged: () => void = () => {}) {}

  async send(chatGuid: string, body: { text: string; replyToGuid?: string; replyToPart?: number; mentions?: MentionAnnotation[] }, clientKey?: string) {
    const textError = outboundTextError(body.text);
    if (textError) return failure(textError, 400);
    let attributedBody: BBAttributedBody | undefined;
    if (body.mentions?.length && this.bb.hasPrivateApi && /^iMessage;/i.test(chatGuid)) {
      const built = buildMentionAttributedBody(body.text, body.mentions);
      if (!built.ok) return failure(built.error, 400);
      attributedBody = built.value;
    }
    await this.directory.summaries();
    let result;
    try {
      result = await this.bb.sendText(chatGuid, body.text,
        body.replyToGuid ? { guid: body.replyToGuid, part: body.replyToPart ?? 0 } : undefined,
        attributedBody, clientKey);
    } catch (error) {
      throw new UnknownSendError(String(error));
    }
    if (!result.ok) return failure(result.error);
    const mapped = mapMessage(result.value, chatGuid, this.names);
    this.directory.applyKnownMessage(chatGuid, mapped);
    return { ok: true as const, value: mapped };
  }

  async react(messageGuid: string, body: { chatGuid: string; reaction: string; remove?: boolean; partIndex?: number; suggested?: boolean }) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled on BlueBubbles", 501);
    const partIndex = body.partIndex ?? 0;
    if (partIndex !== 0) return failure("message part is not reactable", 400);
    const current = await this.bb.messageWithReactions(messageGuid);
    if (!current.ok) return failure(current.error);
    const rawTarget = current.value.find((message) => message.guid === messageGuid);
    if (!rawTarget || !messageBelongsToAnyChat(rawTarget, this.directory.siblingGuids(body.chatGuid))) {
      return failure("reaction target is not valid in this chat", 400);
    }
    const target = buildThread(current.value, body.chatGuid, this.names).find((message) => message.guid === messageGuid);
    if (!target || (body.suggested && target.isFromMe)) return failure("reaction target is not valid in this chat", 400);
    const active = target.reactions.some((reaction) => reaction.isFromMe && reaction.type === body.reaction);
    if (Boolean(body.remove) === !active) return { ok: true as const, value: undefined };
    return checked(await this.sideEffect(() => this.bb.react(body.chatGuid, messageGuid, body.remove ? `-${body.reaction}` : body.reaction, partIndex)));
  }

  async sendContact(chatGuid: string, body: { name: string; address: string; caption?: string }) {
    if (!body.name || !body.address) return failure("name and address required", 400);
    const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
    const field = body.address.includes("@") ? "EMAIL;TYPE=INTERNET" : "TEL;TYPE=CELL";
    const vcard = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escape(body.name)}`, `N:${escape(body.name)};;;;`,
      `${field}:${escape(body.address)}`, "END:VCARD", ""].join("\r\n");
    const filename = `${body.name.replace(/[^\w -]/g, "").trim() || "Contact"}.vcf`;
    await this.directory.summaries();
    const result = await this.sideEffect(() => this.bb.sendAttachmentWithCaption(
      chatGuid, filename, new TextEncoder().encode(vcard), body.caption?.trim() || undefined));
    if (!result.ok) return failure(result.error);
    const message = mapMessage(result.value, chatGuid, this.names);
    this.directory.applyKnownMessage(chatGuid, message);
    return { ok: true as const, value: message };
  }

  async createChat(body: { addresses: string[]; text: string }) {
    const textError = outboundTextError(body.text);
    const addressesError = outboundAddressesError(body.addresses);
    if (textError || addressesError) return failure(textError ?? addressesError!, 400);
    const result = await this.sideEffect(() => this.bb.createChat(body.addresses, body.text));
    if (!result.ok) return failure(result.error);
    const chat = result.value;
    const sent = chat.lastMessage;
    if (!sent) return failure("created chat has no sent message");
    const chatError = createdChatError(chat, body.addresses, sent);
    if (chatError) return failure(chatError);
    const message = mapMessage(sent, chat.guid, this.names, chat.participants ?? []);
    if (!message.isFromMe || message.text !== body.text || message.service !== "iMessage" || message.error !== 0) {
      return failure("created chat returned an invalid sent message");
    }
    this.directory.applyKnownMessage(chat.guid, message);
    return { ok: true as const, value: { chat, message } };
  }

  async participant(chatGuid: string, address: string, action: "add" | "remove") {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    const result = checked(await this.sideEffect(() => action === "remove"
      ? this.bb.removeParticipant(chatGuid, address) : this.bb.addParticipant(chatGuid, address)));
    if (result.ok) this.directory.invalidate();
    return result;
  }

  async leaveGroup(chatGuid: string) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    const result = checked(await this.sideEffect(() => this.bb.leaveGroup(chatGuid)));
    if (result.ok) this.directory.invalidate();
    return result;
  }

  async deleteChat(chatGuid: string) {
    const result = checked(await this.sideEffect(() => this.bb.deleteChat(chatGuid)));
    if (result.ok) this.directory.invalidate();
    return result;
  }

  async createFaceTimeLink(chatGuid: string) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    const result = await this.sideEffect(() => createAndSendFaceTimeLink(this.bb, chatGuid));
    if (!result.ok) return failure(result.error);
    const message = mapMessage(result.value, chatGuid, this.names);
    this.directory.applyKnownMessage(chatGuid, message);
    return { ok: true as const, value: message };
  }

  private async sideEffect<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { throw new UnknownSendError(String(error)); }
  }

  async markRead(chatGuid: string) {
    const results = await Promise.all(this.directory.siblingGuids(chatGuid).map((guid) => this.directory.markRead(guid)));
    return results.some(Boolean);
  }

  async unsend(messageGuid: string, partIndex?: number) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    return checked(await this.bb.unsend(messageGuid, partIndex));
  }

  async edit(messageGuid: string, text: string, partIndex?: number) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    if (!text?.trim()) return failure("text required", 400);
    return checked(await this.bb.edit(messageGuid, text.trim(), partIndex));
  }

  async delete(messageGuid: string, chatGuid: string) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    let lastError = "delete failed";
    for (const guid of this.directory.siblingGuids(chatGuid)) {
      const result = await this.bb.deleteMessage(guid, messageGuid);
      if (result.ok) {
        this.directory.invalidate();
        return { ok: true as const, value: undefined };
      }
      lastError = result.error;
    }
    return failure(lastError);
  }

  async rename(chatGuid: string, name: string) {
    if (!this.bb.hasPrivateApi) return failure("private API disabled", 501);
    const result = checked(await this.bb.renameGroup(chatGuid, name ?? ""));
    if (result.ok) this.directory.invalidate();
    return result;
  }

  async schedule(body: { chatGuid: string; text: string; sendAt: number }, id?: number) {
    if (id !== undefined && (!Number.isInteger(id) || id <= 0)) return failure("invalid schedule id", 400);
    if (!body.chatGuid || !body.text?.trim() || !Number.isFinite(body.sendAt) || body.sendAt <= Date.now()) {
      return failure("chatGuid, text, and a future sendAt are required", 400);
    }
    const result = checked(await (id === undefined
      ? this.bb.createScheduledMessage(body.chatGuid, body.text.trim(), body.sendAt)
      : this.bb.updateScheduledMessage(id, body.chatGuid, body.text.trim(), body.sendAt)));
    if (result.ok) this.scheduledChanged();
    return result;
  }

  async cancelScheduled(id: number) {
    if (!Number.isInteger(id) || id <= 0) return failure("invalid schedule id", 400);
    const result = checked(await this.bb.deleteScheduledMessage(id));
    if (result.ok) this.scheduledChanged();
    return result;
  }
}
