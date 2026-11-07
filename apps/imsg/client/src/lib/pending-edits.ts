import { keyEmoji } from "@shared/platform-profile";
import type { Message } from "@shared/types";

/** What the user asked to happen to a message the server already holds, shown until the server shows it too. */
export type PendingEdit =
  | { kind: "react"; key: string; remove: boolean }
  | { kind: "retract" }
  | { kind: "edit"; text: string };

/** Keyed by message guid. */
export type PendingEdits = ReadonlyMap<string, PendingEdit>;

function hasMine(message: Message, key: string): boolean {
  return message.reactions.some((r) => r.isFromMe && r.key === key);
}

/** Thread queries drop retracted rows, so a retract is reflected once its row is gone. */
function reflects(message: Message | undefined, edit: PendingEdit): boolean {
  if (!message) return edit.kind === "retract";
  switch (edit.kind) {
    case "react": return hasMine(message, edit.key) !== edit.remove;
    case "retract": return message.retracted;
    case "edit": return message.text === edit.text;
  }
}

function apply(message: Message, edit: PendingEdit): Message | null {
  switch (edit.kind) {
    case "react": {
      // I keep one reaction per message, so an add replaces whichever I had.
      const others = message.reactions.filter((r) => !(r.isFromMe && (!edit.remove || r.key === edit.key)));
      const emoji = keyEmoji(edit.key);
      const mine = { key: edit.key, ...(emoji ? { emoji } : {}), isFromMe: true, senderName: null, senderAddress: null };
      return { ...message, reactions: edit.remove ? others : [...others, mine] };
    }
    case "retract": return null;
    case "edit": return { ...message, text: edit.text, edited: true };
  }
}

/** Remote rows as the user's pending intents leave them. Everything else on a row stays remote. */
export function applyPendingEdits(messages: Message[], edits: PendingEdits): Message[] {
  if (edits.size === 0) return messages;
  return messages.flatMap((message) => {
    const edit = edits.get(message.guid);
    if (!edit) return [message];
    const next = apply(message, edit);
    return next ? [next] : [];
  });
}

/** Drops intents the remote rows already show. Returns `edits` itself when none retire. */
export function retirePendingEdits(edits: PendingEdits, messages: readonly Message[]): PendingEdits {
  if (edits.size === 0) return edits;
  const byGuid = new Map(messages.map((message) => [message.guid, message]));
  const done = [...edits].filter(([guid, edit]) => reflects(byGuid.get(guid), edit));
  if (done.length === 0) return edits;
  const next = new Map(edits);
  for (const [guid] of done) next.delete(guid);
  return next;
}
