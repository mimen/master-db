import type { Message, ServerEvent } from "@shared/types";

export function sortByDate(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => a.dateCreated - b.dateCreated);
}

/** `next` under `prev`'s row identity, so replacing a message never remounts its row. */
function carryKey(prev: Message | undefined, next: Message): Message {
  return prev?.clientKey && next.clientKey !== prev.clientKey ? { ...next, clientKey: prev.clientKey } : next;
}

/** Slack for client/server clock skew when pairing a sent message with its temp. */
const TEMP_MATCH_SKEW_MS = 60_000;

/** The pending temp a real outgoing message is the delivery of, matched by text since BlueBubbles echoes no temp guid. */
function pendingTempFor(current: Message[], message: Message): Message | undefined {
  if (!message.isFromMe) return undefined;
  return current.find(
    (m) =>
      m.pending &&
      m.guid.startsWith("temp-") &&
      m.text === message.text &&
      message.dateCreated >= m.dateCreated - TEMP_MATCH_SKEW_MS,
  );
}

/** Live arrival (event stream, local edit, reaction). An outgoing echo takes over its pending temp's row. */
export function upsertMessage(current: Message[], message: Message): Message[] {
  if (message.retracted) return current.filter((m) => m.guid !== message.guid);
  const index = current.findIndex((m) => m.guid === message.guid);
  if (index >= 0) {
    const next = [...current];
    next[index] = carryKey(current[index], message);
    return next;
  }
  const temp = pendingTempFor(current, message);
  const rest = temp ? current.filter((m) => m !== temp) : current;
  return sortByDate([...rest, carryKey(temp, message)]);
}

/** The send settled: the temp's row becomes the real message, whichever of response or echo landed first. */
export function settleTemp(current: Message[], tempGuid: string, message: Message): Message[] {
  const temp = current.find((m) => m.guid === tempGuid);
  const rest = current.filter((m) => m.guid !== tempGuid);
  const index = rest.findIndex((m) => m.guid === message.guid);
  if (index < 0) return sortByDate([...rest, carryKey(temp, message)]);
  const next = [...rest];
  next[index] = carryKey(temp ?? rest[index], message);
  return sortByDate(next);
}

/** This session's own optimistic send, still pending or failed: no fetch can contain it. */
function isOwnUnsettledSend(m: Message): boolean {
  return (m.pending === true || m.failed === true) && m.clientKey?.startsWith("temp-") === true;
}

/**
 * A fetched window replacing what's on screen. Keeps what the fetch couldn't have seen yet:
 * this session's unsettled sends, and anything newer than the window's newest message.
 */
export function mergeWindow(current: Message[], batch: Message[]): Message[] {
  const byGuid = new Map(current.map((m) => [m.guid, m]));
  const claimed = new Set<Message>();
  const merged = batch.map((m) => {
    const known = byGuid.get(m.guid) ?? pendingTempFor(current.filter((c) => !claimed.has(c)), m);
    if (known) claimed.add(known);
    return carryKey(known, m);
  });
  const newest = batch.reduce((max, m) => Math.max(max, m.dateCreated), -Infinity);
  const local = current.filter((m) => !claimed.has(m) && (isOwnUnsettledSend(m) || m.dateCreated > newest));
  return sortByDate([...merged, ...local]);
}

/**
 * Fold a refetched newest window into the loaded one, dropping rows inside its date range that it
 * no longer contains. Returns `current` itself when nothing changed.
 */
export function reconcileWindow(current: Message[], batch: Message[]): Message[] {
  const fetched = new Set(batch.map((m) => m.guid));
  const oldest = batch.reduce((min, m) => Math.min(min, m.dateCreated), Infinity);
  const newest = batch.reduce((max, m) => Math.max(max, m.dateCreated), -Infinity);
  const kept = current.filter(
    (m) => fetched.has(m.guid) || isOwnUnsettledSend(m) || m.dateCreated < oldest || m.dateCreated > newest,
  );
  const next = batch.reduce(upsertMessage, kept);
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}

/** A live tapback folded into its target, the same shape the server builds on reload. */
export function foldReaction(target: Message, event: Extract<ServerEvent, { kind: "reaction" }>): Message {
  const sameSender = (r: Message["reactions"][number]) =>
    event.reaction.isFromMe ? r.isFromMe : !r.isFromMe && r.senderAddress === event.reaction.senderAddress;
  const { type, emoji } = event.reaction;
  const rest = target.reactions.filter(
    (r) => !(sameSender(r) && r.type === type && (!emoji || r.emoji === emoji)),
  );
  return { ...target, reactions: event.remove ? rest : [...rest, event.reaction] };
}

/** iMessage echoes a note-to-self back within seconds; wider gaps are real messages. */
const SELF_ECHO_WINDOW_MS = 10_000;

/**
 * A note-to-self thread (a DM with one of the user's own handles) holds every send twice:
 * the outgoing message and iMessage's inbound echo. Keep the outgoing copy.
 */
export function hideSelfEchoes(messages: readonly Message[]): Message[] {
  const outgoing = messages.filter((m) => m.isFromMe && m.text !== "");
  const isEcho = (m: Message) => !m.isFromMe && m.text !== "" && outgoing.some((own) =>
    own.text === m.text && Math.abs(m.dateCreated - own.dateCreated) <= SELF_ECHO_WINDOW_MS);
  // Only a thread that echoes nearly every send is a note-to-self; one coincidence in a real
  // chat (someone repeating your words) must not hide their message.
  const echoes = messages.filter(isEcho).length;
  if (outgoing.length === 0 || echoes < Math.max(2, outgoing.length * 0.8)) return [...messages];
  // Once the thread is a note-to-self, an unsent message leaves its two or three inbound
  // copies with no outgoing original to match; keep the first of each burst.
  const kept: Message[] = [];
  for (const m of [...messages].sort((a, b) => a.dateCreated - b.dateCreated)) {
    if (isEcho(m)) continue;
    const repeat = !m.isFromMe && m.text !== "" && kept.some((k) =>
      !k.isFromMe && k.text === m.text && m.dateCreated - k.dateCreated <= SELF_ECHO_WINDOW_MS);
    if (!repeat) kept.push(m);
  }
  const keep = new Set(kept);
  return messages.filter((m) => keep.has(m));
}
