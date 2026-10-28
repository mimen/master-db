import { readFileSync } from "node:fs";
import type { BBContact, BBMessage } from "../../server/bb-types";
import type { FakeSeed } from "../../server/bluebubbles-fake";
import type { IdentityDirectory } from "../../server/app";
import type { CrmData, NameSource } from "../../server/name-resolver";
import type { AgentEntry } from "../../client/src/lib/agent-api";
import type { SeedAgentChat } from "./agent";

export const FIXTURE_NOW = Date.UTC(2026, 7, 20, 19, 30, 0);
const fixtureImageBytes = Uint8Array.from(readFileSync(new URL("./assets/run-of-show.png", import.meta.url)));

export const CHAT_GUIDS = {
  needs: "iMessage;-;+16195550101",
  waiting: "iMessage;-;+16195550102",
  unreadGroup: "iMessage;+;fixture-crew",
  coldSms: "SMS;-;+16195550103",
  rcs: "RCS;-;+16195550105",
  unknown: "SMS;-;+16195550999",
} as const;

function message(
  guid: string,
  chatGuid: string,
  text: string,
  minutesAgo: number,
  isFromMe: boolean,
  handle?: string,
  extra: Partial<BBMessage> = {},
): BBMessage {
  return {
    guid,
    text,
    dateCreated: FIXTURE_NOW - minutesAgo * 60_000,
    dateRead: isFromMe ? FIXTURE_NOW - minutesAgo * 60_000 + 1_000 : null,
    isFromMe,
    handle: handle
      ? { address: handle, service: chatGuid.startsWith("SMS;") ? "SMS" : "iMessage" }
      : null,
    chats: [{ guid: chatGuid }],
    ...extra,
  };
}

const backlogNames = [
  "Avery Brooks", "Nina Park", "Diego Santos", "Riley Chen", "Taylor Morgan", "Priya Shah",
  "Marcus Reed", "Leah Kim", "Owen Foster", "Sofia Martinez", "Noah Blake", "Mina Patel",
  // FIXTURE_BACKLOG=300 adds needs-reply conversations so the list paginates like a real inbox.
  ...Array.from({ length: Number(process.env.FIXTURE_BACKLOG ?? 0) }, (_, index) => `Backlog ${index + 1}`),
];

const backlogContacts: BBContact[] = backlogNames.map((displayName, index) => ({
  id: `fixture-backlog-${index}`,
  displayName,
  phoneNumbers: [{ address: `+161955502${String(index).padStart(2, "0")}` }],
}));

const contacts: BBContact[] = [
  { id: "fixture-alex", displayName: "Alex Rivera", phoneNumbers: [{ address: "+16195550101" }] },
  { id: "fixture-jordan", displayName: "Jordan Lee", phoneNumbers: [{ address: "+16195550102" }] },
  { id: "fixture-sam", displayName: "Sam Chen", phoneNumbers: [{ address: "+16195550103" }] },
  { id: "fixture-maya", displayName: "Maya Patel", phoneNumbers: [{ address: "+16195550104" }] },
  ...backlogContacts,
];

export function fixtureSeed(): FakeSeed {
  return {
    privateApi: true,
    contacts,
    chats: [
      {
        guid: CHAT_GUIDS.needs,
        participants: [{ address: "+16195550101", service: "iMessage" }],
        messages: [
          message("needs-1", CHAT_GUIDS.needs, "The venue walkthrough is confirmed.", 90, true),
          message("needs-2", CHAT_GUIDS.needs, "Can you send the final arrival time?", 18, false, "+16195550101"),
        ],
      },
      {
        guid: CHAT_GUIDS.waiting,
        participants: [{ address: "+16195550102", service: "iMessage" }],
        messages: [
          message("waiting-1", CHAT_GUIDS.waiting, "I will check with production.", 65, false, "+16195550102"),
          message("waiting-2", CHAT_GUIDS.waiting, "Thanks, let me know what they say.", 34, true),
        ],
      },
      {
        guid: CHAT_GUIDS.unreadGroup,
        displayName: "Launch Crew",
        participants: [
          { address: "+16195550104", service: "iMessage", originalROWID: 104 },
          { address: "+16195550102", service: "iMessage", originalROWID: 102 },
        ],
        messages: [
          message("group-1", CHAT_GUIDS.unreadGroup, "Deck is in the shared folder.", 52, true),
          message("group-2", CHAT_GUIDS.unreadGroup, "I added the revised run of show.", 9, false, "+16195550104", {
            handleId: 104,
            attachments: [{
              guid: "fixture-image",
              mimeType: "image/png",
              transferName: "run-of-show.png",
              width: 1200,
              height: 800,
              totalBytes: 68,
            }],
          }),
        ],
      },
      ...backlogNames.map((name, index) => {
        const address = `+161955502${String(index).padStart(2, "0")}`;
        const guid = `iMessage;-;${address}`;
        return {
          guid,
          participants: [{ address, service: "iMessage" as const }],
          messages: [
            // A stale error code on Avery's older send offers "Send again"; the newer reply keeps it reading delivered.
            message(`backlog-out-${index}`, guid, `Following up on ${name.split(" ")[0]}'s plan.`, 600 + index * 130, true, undefined,
              index === 0 ? { error: 22 } : {}),
            message(`backlog-in-${index}`, guid, index % 3 === 0 ? "Can you confirm the final details?" : index % 3 === 1 ? "Any update when you get a chance?" : "This looks good, one question remains.", 180 + index * 130, false, address),
          ],
        };
      }),
      {
        guid: CHAT_GUIDS.coldSms,
        participants: [{ address: "+16195550103", service: "SMS" }],
        messages: [message("cold-sms-1", CHAT_GUIDS.coldSms, "Old SMS receipt", 1_440, true)],
      },
      {
        guid: CHAT_GUIDS.rcs,
        participants: [{ address: "+16195550105", service: "RCS" }],
        messages: [message("rcs-1", CHAT_GUIDS.rcs, "Old RCS receipt", 1_500, true)],
      },
      {
        guid: CHAT_GUIDS.unknown,
        participants: [{ address: "+16195550999", service: "SMS" }],
        messages: [message("unknown-1", CHAT_GUIDS.unknown, "Is this still available?", 6, false, "+16195550999")],
      },
    ],
    scheduledMessages: [{
      id: 41,
      type: "send-message",
      payload: {
        chatGuid: CHAT_GUIDS.waiting,
        message: "Checking back tomorrow morning.",
        method: "private-api",
      },
      scheduledFor: FIXTURE_NOW + 14 * 60 * 60_000,
      schedule: { type: "once" },
      status: "pending",
      error: null,
      sentAt: null,
    }],
    attachments: {
      "fixture-image": {
        meta: {
          guid: "fixture-image",
          mimeType: "image/png",
          transferName: "run-of-show.png",
          width: 1200,
          height: 800,
          totalBytes: 68,
        },
        bytes: fixtureImageBytes,
      },
    },
  };
}

/** Backlog conversations the seeded agent chats sit in, one per attention. Nina is left out: live-thread and the ratchets open her. */
export const AGENT_CHAT_GUIDS = {
  needsYou: "iMessage;-;+16195550202",
  ready: "iMessage;-;+16195550203",
  working: "iMessage;-;+16195550204",
  failed: "iMessage;-;+16195550205",
  open: "iMessage;-;+16195550206",
  several: "iMessage;-;+16195550207",
} as const;

const ask = (text: string): AgentEntry => ({ kind: "user", text, steer: false });
const reply = (text: string): AgentEntry => ({ kind: "assistant", text, streaming: false });
const done = (durationMs: number): AgentEntry => ({ kind: "turn_end", outcome: "completed", durationMs, model: "claude-opus-5-5", effort: "high" });

/**
 * One chat per attention across five people, and Leah Kim with two open chats (one ready, one
 * open) and two settled ones (one from the pane, one by settling the conversation).
 */
export const AGENT_SEED: readonly SeedAgentChat[] = [
  {
    conversationId: AGENT_CHAT_GUIDS.needsYou, title: "Load-in time for Saturday", state: "waiting_input", minutesAgo: 4,
    entries: [
      ask("Ask me before you give Diego a load-in time"),
      { kind: "thinking", streaming: false, text: "**Checking the run of show**\n\nDoors are at 9, so load-in is 6 or 7." },
      reply("The run of show allows two load-in windows."),
      { kind: "question", requestId: "seed-load-in", status: "pending", questions: [{
        question: "Which load-in time should I give Diego?", header: "Load-in", multiSelect: false,
        options: [{ label: "6 pm", description: "Before soundcheck" }, { label: "7 pm" }],
      }] },
    ],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.ready, title: "Reply about the guest list", state: "idle", minutesAgo: 12,
    entries: [
      ask("Draft a yes to Riley's guest list question"),
      reply("Riley is on Freaquency 10/31. The draft is below."),
      { kind: "draft", text: "You're on the list for Friday, see you there", note: "Confirmed on Freaquency 10/31", placed: "pane", used: false },
      done(42_000),
    ],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.working, title: "Venues Taylor mentioned", state: "running", minutesAgo: 1,
    entries: [
      ask("Find every venue Taylor mentioned this month"),
      { kind: "todos", todos: [
        { content: "Search the thread", activeForm: "Searching the thread", status: "in_progress" },
        { content: "List the venues", activeForm: "Listing the venues", status: "pending" },
      ] },
      { kind: "thinking", streaming: true, text: "**Searching the thread**\n\nLooking for venue names Taylor mentioned since October 1." },
      { kind: "tool", name: "mcp__comma__search_thread", summary: "Searching the thread for venues", input: JSON.stringify({ query: "venue" }), status: "running" },
    ],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.failed, title: "Priya's deposit", state: "failed", minutesAgo: 30,
    entries: [
      ask("Did Priya's deposit clear?"),
      { kind: "turn_end", outcome: "failed", error: "The gateway timed out after 120 s.", durationMs: 120_000, model: "claude-opus-5-5", effort: "high" },
    ],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.open, title: "Marcus's set length", state: "idle", minutesAgo: 120, seen: true,
    entries: [ask("How long is Marcus's set?"), reply("Marcus plays 90 minutes, 11 to 12:30."), done(9_000)],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.several, title: "Rideshare codes", state: "idle", minutesAgo: 20,
    entries: [ask("Send Leah the rideshare codes"), reply("Here are the three codes Leah asked for."), done(15_000)],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.several, title: "Hotel block for the crew", state: "idle", minutesAgo: 300, seen: true,
    entries: [ask("Hold a hotel block for Leah's crew"), reply("The block is held until Thursday."), done(31_000)],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.several, title: "Flyer feedback", state: "idle", minutesAgo: 1_440, seen: true, settled: "conversation",
    entries: [ask("What did Leah think of the flyer?"), reply("She liked it and asked for a bigger date."), done(12_000)],
  },
  {
    conversationId: AGENT_CHAT_GUIDS.several, title: "Leah's birthday dinner", state: "idle", minutesAgo: 2_880, seen: true, settled: "chat",
    entries: [ask("Find a place for Leah's birthday dinner"), reply("Three places have a table for eight on the 14th."), done(48_000)],
  },
];

const names = new Map<string, string>([
  ["+16195550101", "Alex Rivera"],
  ["+16195550102", "Jordan Lee"],
  ["+16195550103", "Sam Chen"],
  ["+16195550104", "Maya Patel"],
  ["+16195550105", "Dana Whitfield"],
  ...backlogNames.map((name, index) => [`+161955502${String(index).padStart(2, "0")}`, name] as [string, string]),
]);

const personCrm = new Map<string, CrmData>([
  ["+16195550101", {
    is_favorite: true,
    priority: 1,
    tags: ["promoter", "san-diego"],
    events: [{ id: "evt-1", name: "Umbrella Weekend" }],
  }],
  ["+16195550102", { priority: 3, tags: ["production"] }],
]);

const groupCrm = new Map<string, CrmData>([
  [CHAT_GUIDS.unreadGroup, {
    is_favorite: true,
    priority: 2,
    tags: ["launch"],
    events: [{ id: "evt-2", name: "Summer Launch" }],
  }],
]);

export class FixtureIdentity implements NameSource, IdentityDirectory {
  readonly available = true;

  lookup(address: string): string | null {
    return names.get(address) ?? null;
  }

  searchTerms(address: string): string[] {
    const name = this.lookup(address);
    return name ? [name.toLowerCase()] : [];
  }

  chatCrm(chatGuid: string): CrmData | undefined {
    return groupCrm.get(chatGuid);
  }

  personCrm(address: string): CrmData | undefined {
    return personCrm.get(address);
  }

  search(query: string, limit: number): Array<{ address: string; name: string; is_favorite?: boolean }> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return [...names]
      .filter(([address, name]) => address.includes(needle) || name.toLowerCase().includes(needle))
      .slice(0, limit)
      .map(([address, name]) => ({
        address,
        name,
        is_favorite: personCrm.get(address)?.is_favorite,
      }));
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  start(): void {}
  stop(): void {}
}

const backlog = (name: string) => `iMessage;-;+161955502${String(backlogNames.indexOf(name)).padStart(2, "0")}`;
const todayItem = (conversationId: string, reason: string, waiting = false) => ({ conversationId, reason, waiting });

/**
 * The morning's Today queue over the fixture world, built two hours before FIXTURE_NOW, so Launch
 * Crew's later inbound lands in New since. Jordan is the queued Waiting; Noah and Mina sit below the line.
 */
export const TODAY_SEED = {
  snapshotAt: FIXTURE_NOW - 2 * 3_600_000,
  model: "claude-opus-5-5",
  brief: "Friday's show is the center of gravity: the arrival time and the guest list both close tonight. Two people are waiting on money from you.",
  readCount: 15,
  groups: [
    { id: "friday", title: "Friday at the Observatory", context: "The arrival time and the guest list both close tonight. Start with Alex.", items: [
      todayItem(CHAT_GUIDS.needs, "The final arrival time unblocks the run of show."),
      todayItem(backlog("Priya Shah"), "Guest list locks at 6 PM."),
      todayItem(CHAT_GUIDS.waiting, "Production's answer decides the load-in.", true),
      todayItem(backlog("Diego Santos"), "He needs a load-in time before soundcheck."),
    ] },
    { id: "money", title: "Money", context: "One deposit is owed and one invoice is due tomorrow.", items: [
      todayItem(backlog("Nina Park"), "Second time she has asked since Friday."),
      todayItem(backlog("Marcus Reed"), "Due tomorrow. Approve it or flag it."),
      todayItem(backlog("Riley Chen"), "No reply in 5 days. Worth one nudge."),
    ] },
    { id: "people", title: "People you care about", context: "Personal threads that have sat longer than you would want.", items: [
      todayItem(backlog("Avery Brooks"), "Needs a yes or a new day before Thursday."),
      todayItem(backlog("Leah Kim"), "A thank-you owed since Saturday."),
      todayItem(backlog("Taylor Morgan"), "A tapback closes it."),
      todayItem(backlog("Owen Foster"), "Yes or no."),
      todayItem(backlog("Sofia Martinez"), "Catch-up, no deadline."),
    ] },
  ],
  below: [backlog("Noah Blake"), backlog("Mina Patel")],
} as const;
