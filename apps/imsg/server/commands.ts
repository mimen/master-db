import type { BBAttributedBody } from "./bb-types";
import type { BlueBubbles, Result } from "./bluebubbles";
import type { ChatDirectory } from "./chat-directory";
import type { MentionAnnotation } from "../shared/mentions";
import { buildThread, mapMessage } from "./map";
import { buildMentionAttributedBody } from "./mention-body";
import { messageBelongsToAnyChat, outboundTextError } from "./message-verification";
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
    return checked(await this.bb.react(body.chatGuid, messageGuid, body.remove ? `-${body.reaction}` : body.reaction, partIndex));
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
