import type { GenericId } from "convex/values";

import { gmail } from "../../../../convex/comma/conversationIdentity";
import { cleanEmailHtml } from "../../../../convex/comma/emailHtml";
import { parseAddresses } from "../../../../convex/comma/gmailMessage";
import { unsupportedReason } from "../../../../convex/comma/routeSupport";
import type { CommandResult, CommaOutboxPayload } from "../../../../convex/schema/comma/validators";
import { conversationFlags, type ChatState } from "../../shared/chat-state";
import { fixtureConversationId } from "../../shared/fixture-ids";
import { pendingGuid } from "../../shared/pending-send";

import { FIXTURE_NOW } from "./world";

/**
 * The fixture's mailbox, as convex/comma/queries.ts listEmailThreads and listMessages return it: a known sender's thread
 * whose HTML carries a script, a tracking pixel and a remote image, a newsletter, and a stranger. The HTML goes through
 * the real cleaner, convex/comma/emailHtml.ts; convex/comma/gmailSync.test.ts proves the sync that stores it.
 *
 * Its lane runs as convex/comma/gmailLane.ts does: a send lands as Gmail's message in its thread, a send whose answer is
 * lost ends unknown until the check finds it, and a settle archives the thread (an unsettle unarchives it), or, when
 * Gmail refuses, takes the settle back with Gmail's error. convex/comma/gmailLane.test.ts proves the real ones.
 */

const ACCOUNT = "account-gmail" as GenericId<"comma_accounts">;
const MILAD = { address: "milad@afternoonumbrellafriends.com", name: null };
const MINUTE = 60_000;

/** What the venue's reply looks like before Comma cleans it. */
export const HOSTILE_HTML = `<html><head><style>.cta{color:#c2410c}</style><script>window.parent.__mailScript = true; alert("pwned")</script></head>
<body onload="window.parent.__mailOnload = true"><div><p>Hi Milad,</p><p>Load-in is at <b>6 pm</b>, doors at 8. Floor plan below.</p>
<img src="https://cdn.example.test/floor-plan.png" width="560" alt="Floor plan">
<img src="https://track.example.test/open.gif?u=milad" width="1" height="1" alt="">
<p><a class="cta" href="https://example.test/advance">Advance sheet</a></p><p>Sam</p></div>
<div class="gmail_quote">On Thu, Aug 20, 2026 Milad wrote:<blockquote>What time is load-in?</blockquote></div></body></html>`;

type Address = { address: string; name: string | null };
type Mail = {
  id: string; from: Address; minutesAgo?: number; at?: number; text: string; html?: string; fromMe?: boolean; to?: Address[]; cc?: Address[];
  clientKey?: string; sendState?: "sending" | "failed";
};
type Thread = {
  key: string; subject: string; known: boolean; bulk: boolean; participant: Address; mail: Mail[];
  inInbox: boolean; state: ChatState | undefined; archiveError?: string;
};
type Receipt = { id: string; status: "pending" | "sent" | "failed" | "unknown"; clientKey: string; updatedAt: number; error?: string; result?: CommandResult; resultGuid?: string };

const seedThreads = (): Thread[] => [
  {
    key: "t-venue", subject: "Load-in for Saturday", known: true, bulk: false, participant: { address: "sam@venue.test", name: "Sam Lee" },
    inInbox: true, state: undefined,
    mail: [
      { id: "mv1", from: MILAD, fromMe: true, minutesAgo: 180, text: "What time is load-in?" },
      {
        id: "mv2", from: { address: "sam@venue.test", name: "Sam Lee" }, minutesAgo: 25, text: "Hi Milad, Load-in is at 6 pm, doors at 8.", html: HOSTILE_HTML,
        to: [MILAD], cc: [{ address: "dana@venue.test", name: "Dana Ortiz" }],
      },
    ],
  },
  {
    key: "t-weekly", subject: "This week at the club", known: false, bulk: true, participant: { address: "news@club.test", name: "Club Weekly" },
    inInbox: true, state: undefined,
    mail: [{ id: "mw1", from: { address: "news@club.test", name: "Club Weekly" }, minutesAgo: 60, text: "Five shows, one new room, and a members' night." }],
  },
  {
    key: "t-stranger", subject: "Booking inquiry", known: false, bulk: false, participant: { address: "pat@agency.test", name: "Pat Moreno" },
    inInbox: true, state: undefined,
    mail: [{ id: "ms1", from: { address: "pat@agency.test", name: "Pat Moreno" }, minutesAgo: 90, text: "Is the 14th still open for a two-hour set?" }],
  },
];

const guidOf = (thread: Thread) => `mail:${thread.key}`;
const dateOf = (mail: Mail) => mail.at ?? FIXTURE_NOW - (mail.minutesAgo ?? 0) * MINUTE;

function message(thread: Thread, mail: Mail) {
  const cleaned = mail.html === undefined ? undefined : cleanEmailHtml(mail.html);
  const dateCreated = dateOf(mail);
  const guid = mail.sendState ? pendingGuid(mail.clientKey!) : mail.id;
  return {
    _id: guid, _creationTime: dateCreated, platform: "gmail" as const, accountId: ACCOUNT, guid, conversationId: guidOf(thread),
    dateCreated, isFromMe: mail.fromMe === true, sender: { address: mail.from.address, name: mail.fromMe ? null : thread.known ? mail.from.name : null },
    text: mail.text, subject: thread.subject, threadRef: thread.key, edited: false, retracted: false, isGroupEvent: false, mentions: [],
    attachmentGuids: [], attachments: [], reactions: [], sourceVersion: 0,
    ...(mail.clientKey ? { clientKey: mail.clientKey } : {}), ...(mail.sendState ? { sendState: mail.sendState } : {}),
    ...(mail.sendState ? {} : {
      gmail: { from: mail.from, to: mail.to ?? [mail.fromMe ? thread.participant : MILAD], cc: mail.cc ?? [], bulk: thread.bulk,
        ...(cleaned ? { html: cleaned.html, blockedImages: cleaned.blockedImages } : {}) },
    }),
  };
}

function conversation(thread: Thread) {
  const last = thread.mail[thread.mail.length - 1]!;
  const lastMessageAt = dateOf(last);
  const lastMessage = { guid: message(thread, last).guid, text: last.text, dateCreated: lastMessageAt, isFromMe: last.fromMe === true, senderName: last.from.name, hasAttachments: false };
  const { flags, unreadCount } = conversationFlags({ platform: "gmail", kind: "emailThread" }, thread.state, lastMessage, lastMessageAt, 0);
  return {
    _id: fixtureConversationId(guidOf(thread)), _creationTime: FIXTURE_NOW, platform: "gmail" as const, accountId: ACCOUNT,
    conversationKey: gmail.conversationKey(thread.key), kind: "emailThread" as const, isGroup: true,
    gmail: { threadId: thread.key, subject: thread.subject, inInbox: thread.inInbox, bulk: thread.bulk, ...(thread.archiveError ? { archiveError: thread.archiveError } : {}) },
    displayName: thread.known ? thread.participant.name! : thread.participant.name ?? thread.participant.address, rawDisplayName: "",
    participants: [{ address: thread.participant.address, name: thread.known ? thread.participant.name : null, photoUrl: null }],
    lastMessage, lastMessageAt, isSpam: false, updatedAt: FIXTURE_NOW, flags, unreadCount, groupPhotoUrl: null, known: thread.known,
    contactsAvailable: true, searchNames: [],
  };
}

export function createMailFixture(receipts: Map<string, Receipt>) {
  let threads = seedThreads();
  let sent = 0;
  /** The next send goes out, then its answer is lost; the check finds it after this many ms. */
  let loseNextAnswer: number | null = null;
  /** Gmail refuses the next archive or unarchive with this error. */
  let refuseNextArchive: string | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const find = (key: string) => threads.find((thread) => guidOf(thread) === key);
  const receipt = (clientKey: string, fields: Omit<Receipt, "id" | "clientKey" | "updatedAt">) => {
    const next = { id: `outbox-${clientKey}`, clientKey, updatedAt: Date.now(), ...fields };
    receipts.set(clientKey, next);
    return next.id;
  };
  const settleState = (thread: Thread): ChatState => {
    const last = conversation(thread).lastMessage;
    return { mutedUnresponded: false, pinned: false, markedUnread: false, readAt: 0,
      ...(last.isFromMe ? { dismissedWaitingGuid: last.guid } : { dismissedUnrespondedGuid: last.guid }) };
  };

  /** Gmail took the send: it lands in its thread as Gmail's message, as onResult and landFoundSend land it. */
  const land = (thread: Thread, clientKey: string, payload: Extract<CommaOutboxPayload, { kind: "send" }>) => {
    const id = `sent-${++sent}`;
    const to = parseAddresses(payload.email!.to.join(", "));
    const cc = parseAddresses(payload.email!.cc.join(", "));
    thread.mail = [...thread.mail.filter((mail) => mail.clientKey !== clientKey),
      { id, from: MILAD, fromMe: true, at: Date.now(), text: payload.text, to, cc, clientKey }];
    return { id, result: { kind: "send" as const, guid: id, gmail: {
      id, threadId: thread.key, internalDate: Date.now(), labelIds: ["SENT"], from: MILAD, to, cc, subject: payload.email!.subject,
      snippet: payload.text.slice(0, 200), bulk: false, text: payload.text, model: { threadRef: thread.key },
    } } };
  };

  const writeBack = (thread: Thread, kind: "archive" | "unarchive") => {
    const clientKey = `${kind}-${thread.key}-${Date.now()}`;
    thread.archiveError = undefined;
    if (refuseNextArchive === null) {
      thread.inInbox = kind === "unarchive";
      return receipt(clientKey, { status: "sent", result: { kind, ok: true } });
    }
    const error = refuseNextArchive;
    refuseNextArchive = null;
    thread.state = kind === "archive" ? undefined : settleState(thread);
    thread.archiveError = `Gmail didn't ${kind} this: ${error}`;
    return receipt(clientKey, { status: "failed", error });
  };

  const enqueue = (key: string, clientKey: string, payload: CommaOutboxPayload): string => {
    const thread = find(key)!;
    const unsupported = unsupportedReason({ platform: "gmail", accountId: ACCOUNT, threadId: thread.key }, true, payload);
    if (unsupported) throw new Error(unsupported);
    if (payload.kind === "markRead") return receipt(clientKey, { status: "sent", result: { kind: "markRead", ok: true } });
    if (payload.kind !== "send") throw new Error(`The fixture's Gmail runs no ${payload.kind}`);
    thread.mail = [...thread.mail, { id: clientKey, from: MILAD, fromMe: true, at: Date.now(), text: payload.text, clientKey, sendState: "sending" }];
    if (loseNextAnswer === null) {
      const { id, result } = land(thread, clientKey, payload);
      return receipt(clientKey, { status: "sent", result, resultGuid: id });
    }
    const checkAfter = loseNextAnswer;
    loseNextAnswer = null;
    thread.mail = thread.mail.map((mail) => (mail.clientKey === clientKey ? { ...mail, sendState: "failed" } : mail));
    const timer = setTimeout(() => {
      timers.delete(timer);
      const { id, result } = land(thread, clientKey, payload);
      receipt(clientKey, { status: "sent", result, resultGuid: id });
    }, checkAfter);
    timers.add(timer);
    return receipt(clientKey, { status: "unknown", error: "The operation timed out." });
  };

  const reset = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    threads = seedThreads();
    sent = 0;
    loseNextAnswer = null;
    refuseNextArchive = null;
  };

  return {
    owns: (key: string) => find(key) !== undefined,
    threads: () => threads.filter((thread) => thread.inInbox).map(conversation).sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    conversation: (key: string) => {
      const thread = find(key);
      return thread ? conversation(thread) : null;
    },
    /** Messages whose text holds `text`, as searchMessages returns them. */
    search: (text: string) => threads.flatMap((thread) => thread.mail.filter((mail) => !mail.sendState).map((mail) => message(thread, mail)))
      .filter((row) => row.text.toLowerCase().includes(text.toLowerCase())).map(({ attachments: _attachments, ...row }) => row),
    /** Newest first, as listMessages pages. */
    messages: (key: string) => {
      const thread = find(key);
      return thread ? thread.mail.map((mail) => message(thread, mail)).sort((a, b) => b.dateCreated - a.dateCreated) : [];
    },
    enqueue,
    /** comma/triage settle and unsettle, written back as archive and unarchive. */
    settle: (key: string) => {
      const thread = find(key)!;
      thread.state = settleState(thread);
      writeBack(thread, "archive");
      return null;
    },
    unsettle: (key: string) => {
      const thread = find(key)!;
      thread.state = undefined;
      writeBack(thread, "unarchive");
      return null;
    },
    loseNextAnswer: (checkAfterMs: number) => {
      loseNextAnswer = checkAfterMs;
    },
    refuseNextArchive: (error: string) => {
      refuseNextArchive = error;
    },
    reset,
  };
}
