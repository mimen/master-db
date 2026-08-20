import { readFileSync } from "node:fs";
import type { BBContact, BBMessage } from "../../server/bb-types";
import type { FakeSeed } from "../../server/bluebubbles-fake";
import type { IdentityDirectory } from "../../server/app";
import type { CrmData, NameSource } from "../../server/name-resolver";

export const FIXTURE_NOW = Date.UTC(2026, 7, 20, 19, 30, 0);
const fixtureImageBytes = Uint8Array.from(readFileSync(new URL("./assets/run-of-show.png", import.meta.url)));

export const CHAT_GUIDS = {
  needs: "iMessage;-;+16195550101",
  waiting: "iMessage;-;+16195550102",
  unreadGroup: "iMessage;+;fixture-crew",
  archived: "SMS;-;+16195550103",
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
] as const;

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
            message(`backlog-out-${index}`, guid, `Following up on ${name.split(" ")[0]}'s plan.`, 600 + index * 130, true),
            message(`backlog-in-${index}`, guid, index % 3 === 0 ? "Can you confirm the final details?" : index % 3 === 1 ? "Any update when you get a chance?" : "This looks good, one question remains.", 180 + index * 130, false, address),
          ],
        };
      }),
      {
        guid: CHAT_GUIDS.archived,
        participants: [{ address: "+16195550103", service: "SMS" }],
        messages: [message("archived-1", CHAT_GUIDS.archived, "Old SMS receipt", 1_440, true)],
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

const names = new Map<string, string>([
  ["+16195550101", "Alex Rivera"],
  ["+16195550102", "Jordan Lee"],
  ["+16195550103", "Sam Chen"],
  ["+16195550104", "Maya Patel"],
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
