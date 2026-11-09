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
 * whose HTML carries a script, a tracking pixel and a remote image, a newsletter, and a stranger with a remote image. The HTML goes through
 * the real cleaner, convex/comma/emailHtml.ts; convex/comma/gmailSync.test.ts proves the sync that stores it.
 *
 * On request it also holds an invoice thread with a PDF, a photo and an inline logo, as convex/comma/gmailFiles.ts stores
 * them. Its lane runs as convex/comma/gmailLane.ts does: a send lands as Gmail's message in its thread (a sendEmail as
 * a new thread), with the files it carried, a send whose answer is
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
/** A stored attachment; `contentId` marks an image the HTML body shows inline. */
type MailFixtureFile = { name: string; mimeType: string; size: number; storageId: string; contentId?: string };
type Mail = {
  id: string; from: Address; minutesAgo?: number; at?: number; text: string; html?: string; fromMe?: boolean; to?: Address[]; cc?: Address[];
  clientKey?: string; sendState?: "sending" | "failed"; files?: MailFixtureFile[];
};
/** Where the fixture serves a stored file, as Convex storage would. */
export const mailFileUrl = (storageId: string) => `/__fixture/mail-file/${storageId}`;
type Thread = {
  key: string; subject: string; known: boolean; bulk: boolean; participant: Address; mail: Mail[];
  inInbox: boolean; state: ChatState | undefined; archiveError?: string;
  /** Messages Gmail labels UNREAD, as gmailSync counts them. */
  unread?: number;
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
    mail: [{
      id: "ms1", from: { address: "pat@agency.test", name: "Pat Moreno" }, minutesAgo: 90, text: "Is the 14th still open for a two-hour set?",
      html: `<p>Is the 14th still open for a two-hour set?</p><img src="https://cdn.example.test/press-shot.jpg" width="400" alt="Press shot">`,
    }],
  },
];

const JORDAN = { address: "jordan@agency.test", name: "Jordan Kim" };
const ROUTING = "Austin 3/12, Dallas 3/14, Houston 3/15, New Orleans 3/18.";
const gmailReply = (body: string, attribution: string, quoted: string) =>
  `<div dir="ltr">${body}</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attribution}</div>` +
  `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${quoted}</blockquote></div>`;
const first = `<div dir="ltr"><p>Hi Milad,</p><p>Here is the draft routing for March: ${ROUTING}</p><p>Holds expire Friday.</p><p>Jordan</p></div>`;
const apple = `<div>Houston can move to the 16th if that helps the drive.</div><div><br></div><div>On Mar 2, 2027, at 4:10 PM, Milad &lt;milad@afternoonumbrellafriends.com&gt; wrote:<br><br></div>` +
  `<blockquote type="cite"><div>Dallas to Houston is tight. Can Houston slide a day?</div><div><br></div><div>&gt; ${ROUTING}</div></blockquote>`;
const third = gmailReply("<p>Houston confirmed for the 16th. Updated sheet attached.</p><p>Jordan</p>", "On Tue, Mar 3, 2027 at 9:02 AM Jordan Kim &lt;jordan@agency.test&gt; wrote:<br>", apple);
const fourth = gmailReply("<p>One more: New Orleans wants a 10 pm set instead of 11. OK?</p><p>Jordan</p>", "On Wed, Mar 4, 2027 at 11:40 AM Jordan Kim &lt;jordan@agency.test&gt; wrote:<br>", third);

/** A long thread whose replies quote everything before them, the last two unread, seeded on request. */
const longThread = (): Thread => ({
  key: "t-tour", subject: "March routing", known: true, bulk: false, participant: JORDAN, inInbox: true, state: undefined, unread: 2,
  mail: [
    { id: "mt1", from: JORDAN, minutesAgo: 4 * 1440, text: `Hi Milad, Here is the draft routing for March: ${ROUTING} Holds expire Friday. Jordan`, html: first },
    { id: "mt2", from: MILAD, fromMe: true, minutesAgo: 3 * 1440, to: [JORDAN],
      text: `Dallas to Houston is tight. Can Houston slide a day?\n\nOn Sun, Mar 1, 2027 at 10:15 AM Jordan Kim <jordan@agency.test> wrote:\n> Hi Milad,\n> Here is the draft routing for March: ${ROUTING}\n> Holds expire Friday.\n> Jordan` },
    { id: "mt3", from: JORDAN, minutesAgo: 2 * 1440, text: "Houston can move to the 16th if that helps the drive.", html: apple },
    { id: "mt4", from: JORDAN, minutesAgo: 1440, text: "Houston confirmed for the 16th. Updated sheet attached.", html: third },
    { id: "mt5", from: JORDAN, minutesAgo: 12, text: "One more: New Orleans wants a 10 pm set instead of 11. OK?", html: fourth },
  ],
});

const ROSA = { address: "rosa@venue.test", name: "Rosa Diaz" };
const INVOICE = "mail-invoice-42.pdf";

/** The venue's invoice: Rosa sends it to Milad with Sam on To and Dana on Cc, then Sam adds the stage photo. */
const invoiceThread = (): Thread => ({
  key: "t-invoice", subject: "Invoice #42 for Saturday", known: true, bulk: false, participant: ROSA, inInbox: true, state: undefined,
  mail: [
    {
      id: "mi1", from: ROSA, minutesAgo: 240, to: [MILAD, { address: "sam@venue.test", name: "Sam Lee" }], cc: [{ address: "dana@venue.test", name: "Dana Ortiz" }],
      text: "Hi Milad, invoice #42 for Saturday is attached. Net 15. Rosa",
      html: '<p>Hi Milad, invoice #42 for Saturday is attached. Net 15.</p><p>Rosa</p><img src="cid:logo@venue" alt="Venue logo" width="120">',
      files: [
        { name: "invoice-42.pdf", mimeType: "application/pdf", size: 48_213, storageId: INVOICE },
        { name: "logo.png", mimeType: "image/png", size: 2_311, storageId: "mail-logo.png", contentId: "logo@venue" },
      ],
    },
    {
      id: "mi2", from: { address: "sam@venue.test", name: "Sam Lee" }, minutesAgo: 30, to: [MILAD, ROSA], cc: [{ address: "dana@venue.test", name: "Dana Ortiz" }],
      text: "Adding the stage photo for the advance.",
      files: [{ name: "stage.png", mimeType: "image/png", size: 91_540, storageId: "mail-stage.png" }],
    },
  ],
});

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
    attachmentGuids: (mail.files ?? []).map((_, index) => `${mail.id}:${index + 1}`), attachments: (mail.files ?? []).map((file, index) => attachmentOf(thread, mail, file, index)),
    reactions: [], sourceVersion: 0,
    ...(mail.clientKey ? { clientKey: mail.clientKey } : {}), ...(mail.sendState ? { sendState: mail.sendState } : {}),
    ...(mail.sendState ? {} : {
      gmail: { from: mail.from, to: mail.to ?? [mail.fromMe ? thread.participant : MILAD], cc: mail.cc ?? [], bulk: thread.bulk,
        ...(cleaned ? { html: cleaned.html, blockedImages: cleaned.blockedImages } : {}) },
    }),
  };
}

/** A stored attachment as listMessages serves it. */
function attachmentOf(thread: Thread, mail: Mail, file: MailFixtureFile, index: number) {
  const guid = `${mail.id}:${index + 1}`;
  return {
    _id: guid, _creationTime: FIXTURE_NOW, platform: "gmail" as const, accountId: ACCOUNT, guid, messageGuid: mail.id, conversationId: guidOf(thread),
    mimeType: file.mimeType, filename: file.name, totalBytes: file.size, hideAttachment: false, sourceVersion: 0,
    originalStorageId: file.storageId, gmail: { partId: String(index + 1), inline: file.contentId !== undefined, ...(file.contentId ? { contentId: file.contentId } : {}) },
    thumbUrl: null, originalUrl: mailFileUrl(file.storageId),
  };
}

function conversation(thread: Thread) {
  const last = thread.mail[thread.mail.length - 1]!;
  const lastMessageAt = dateOf(last);
  const lastMessage = { guid: message(thread, last).guid, text: last.text, dateCreated: lastMessageAt, isFromMe: last.fromMe === true, senderName: last.from.name, hasAttachments: false };
  const { flags, unreadCount } = conversationFlags({ platform: "gmail", kind: "emailThread" }, thread.state, lastMessage, lastMessageAt, thread.unread ?? 0);
  return {
    _id: fixtureConversationId(guidOf(thread)), _creationTime: FIXTURE_NOW, platform: "gmail" as const, accountId: ACCOUNT,
    conversationKey: gmail.conversationKey(thread.key), kind: "emailThread" as const, isGroup: true,
    gmail: { threadId: thread.key, subject: thread.subject, inInbox: thread.inInbox, bulk: thread.bulk, ...(thread.unread ? { unread: thread.unread } : {}), ...(thread.archiveError ? { archiveError: thread.archiveError } : {}) },
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

  /** Gmail took the send: it lands in its thread as Gmail's message, with its files, as onResult and landFoundSend land it. */
  const land = (thread: Thread, clientKey: string, payload: Extract<CommaOutboxPayload, { kind: "send" | "sendEmail" }>) => {
    const id = `sent-${++sent}`;
    const to = parseAddresses(payload.email!.to.join(", "));
    const cc = parseAddresses(payload.email!.cc.join(", "));
    const files = (payload.email!.attachments ?? []).map((file) => ({ name: file.filename, mimeType: file.mimeType, size: 0, storageId: String(file.storageId) }));
    thread.mail = [...thread.mail.filter((mail) => mail.clientKey !== clientKey),
      { id, from: MILAD, fromMe: true, at: Date.now(), text: payload.text, to, cc, clientKey, files }];
    return { id, result: { kind: payload.kind === "send" ? "send" as const : "sendEmail" as const, guid: id, gmail: {
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

  /** A new email or a forward: Gmail starts a thread, which lands outside the inbox, as sent mail does. */
  const sendEmail = (clientKey: string, payload: Extract<CommaOutboxPayload, { kind: "sendEmail" }>): string => {
    if (!payload.email.to.length && !payload.email.cc.length) throw new Error("An email needs someone to send it to");
    const recipient = parseAddresses(payload.email.to.join(", "))[0] ?? parseAddresses(payload.email.cc.join(", "))[0]!;
    const thread: Thread = { key: `t-new-${sent + 1}`, subject: payload.email.subject, known: true, bulk: false, participant: recipient, inInbox: false, state: undefined, mail: [] };
    threads = [...threads, thread];
    const { id, result } = land(thread, clientKey, payload);
    receipt(clientKey, { status: "sent", result, resultGuid: id });
    return `outbox-${clientKey}`;
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
      // Production's settle answers with the archive it queued, which the client watches for a refusal.
      return writeBack(thread, "archive");
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
    sendEmail,
    attachment: (guid: string) => threads.flatMap((thread) => thread.mail.flatMap((mail) => (mail.files ?? []).map((file, index) => attachmentOf(thread, mail, file, index))))
      .find((row) => row.guid === guid) ?? null,
    seedInvoice: () => {
      if (!find("mail:t-invoice")) threads = [...threads, invoiceThread()];
    },
    seedLongThread: () => {
      if (!find("mail:t-tour")) threads = [...threads, longThread()];
    },
    reset,
  };
}
