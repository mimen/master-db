import type { GenericId } from "convex/values";

import { gmail } from "../../../../convex/comma/conversationIdentity";
import { cleanEmailHtml } from "../../../../convex/comma/emailHtml";
import { conversationFlags } from "../../shared/chat-state";
import { fixtureConversationId } from "../../shared/fixture-ids";

import { FIXTURE_NOW } from "./world";

/**
 * The fixture's mailbox, as convex/comma/queries.ts listEmailThreads and listMessages return it: a known sender's thread
 * whose HTML carries a script, a tracking pixel and a remote image, a newsletter, and a stranger. The HTML goes through
 * the real cleaner, convex/comma/emailHtml.ts; convex/comma/gmailSync.test.ts proves the sync that stores it.
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

type Mail = { id: string; from: { address: string; name: string | null }; minutesAgo: number; text: string; html?: string; fromMe?: boolean };
type Thread = { key: string; subject: string; known: boolean; bulk: boolean; participant: { address: string; name: string | null }; mail: Mail[] };

const THREADS: Thread[] = [
  {
    key: "t-venue", subject: "Load-in for Saturday", known: true, bulk: false, participant: { address: "sam@venue.test", name: "Sam Lee" },
    mail: [
      { id: "mv1", from: MILAD, fromMe: true, minutesAgo: 180, text: "What time is load-in?" },
      { id: "mv2", from: { address: "sam@venue.test", name: "Sam Lee" }, minutesAgo: 25, text: "Hi Milad, Load-in is at 6 pm, doors at 8.", html: HOSTILE_HTML },
    ],
  },
  {
    key: "t-weekly", subject: "This week at the club", known: false, bulk: true, participant: { address: "news@club.test", name: "Club Weekly" },
    mail: [{ id: "mw1", from: { address: "news@club.test", name: "Club Weekly" }, minutesAgo: 60, text: "Five shows, one new room, and a members' night." }],
  },
  {
    key: "t-stranger", subject: "Booking inquiry", known: false, bulk: false, participant: { address: "pat@agency.test", name: "Pat Moreno" },
    mail: [{ id: "ms1", from: { address: "pat@agency.test", name: "Pat Moreno" }, minutesAgo: 90, text: "Is the 14th still open for a two-hour set?" }],
  },
];

const guidOf = (thread: Thread) => `mail:${thread.key}`;

function message(thread: Thread, mail: Mail) {
  const cleaned = mail.html === undefined ? undefined : cleanEmailHtml(mail.html);
  const dateCreated = FIXTURE_NOW - mail.minutesAgo * MINUTE;
  return {
    _id: mail.id, _creationTime: dateCreated, platform: "gmail" as const, accountId: ACCOUNT, guid: mail.id, conversationId: guidOf(thread),
    dateCreated, isFromMe: mail.fromMe === true, sender: { address: mail.from.address, name: mail.fromMe ? null : thread.known ? mail.from.name : null },
    text: mail.text, subject: thread.subject, threadRef: thread.key, edited: false, retracted: false, isGroupEvent: false, mentions: [],
    attachmentGuids: [], attachments: [], reactions: [], sourceVersion: 0,
    gmail: { from: mail.from, to: [mail.fromMe ? thread.participant : MILAD], cc: [], bulk: thread.bulk,
      ...(cleaned ? { html: cleaned.html, blockedImages: cleaned.blockedImages } : {}) },
  };
}

function conversation(thread: Thread) {
  const last = thread.mail[thread.mail.length - 1]!;
  const lastMessageAt = FIXTURE_NOW - last.minutesAgo * MINUTE;
  const lastMessage = { guid: last.id, text: last.text, dateCreated: lastMessageAt, isFromMe: last.fromMe === true, senderName: last.from.name, hasAttachments: false };
  const { flags, unreadCount } = conversationFlags({ platform: "gmail", kind: "emailThread" }, undefined, lastMessage, lastMessageAt, 0);
  return {
    _id: fixtureConversationId(guidOf(thread)), _creationTime: FIXTURE_NOW, platform: "gmail" as const, accountId: ACCOUNT,
    conversationKey: gmail.conversationKey(thread.key), kind: "emailThread" as const, isGroup: true,
    gmail: { threadId: thread.key, subject: thread.subject, inInbox: true, bulk: thread.bulk },
    displayName: thread.known ? thread.participant.name! : thread.participant.name ?? thread.participant.address, rawDisplayName: "",
    participants: [{ address: thread.participant.address, name: thread.known ? thread.participant.name : null, photoUrl: null }],
    lastMessage, lastMessageAt, isSpam: false, updatedAt: FIXTURE_NOW, flags, unreadCount, groupPhotoUrl: null, known: thread.known,
    contactsAvailable: true, searchNames: [],
  };
}

export const mailWorld = {
  owns: (key: string) => THREADS.some((thread) => guidOf(thread) === key),
  threads: () => [...THREADS].map(conversation).sort((a, b) => b.lastMessageAt - a.lastMessageAt),
  /** Messages whose text holds `text`, as searchMessages returns them. */
  search: (text: string) => THREADS.flatMap((thread) => thread.mail.map((mail) => message(thread, mail)))
    .filter((row) => row.text.toLowerCase().includes(text.toLowerCase())).map(({ attachments: _attachments, ...row }) => row),
  /** Newest first, as listMessages pages. */
  messages: (key: string) => {
    const thread = THREADS.find((candidate) => guidOf(candidate) === key);
    return thread ? thread.mail.map((mail) => message(thread, mail)).sort((a, b) => b.dateCreated - a.dateCreated) : [];
  },
};
