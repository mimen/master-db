/**
 * The render fixture: a wholly invented Chat Directory used to drive the app
 * for screenshots.
 *
 * NOTHING in this file may come from a real conversation. Every name, handle,
 * and message body here is fabricated, and the phone numbers are drawn from the
 * NANP fictional range (555-01xx) so they cannot dial anyone. The render lane
 * exists precisely so visual QA never has to point a camera at real history.
 *
 * The seed is shaped around the four state lenses the app is built on — Unread,
 * Unresponded, Waiting, Archived (see CONTEXT.md) — so a capture that flips
 * between them shows a populated, differently-populated list every time.
 */
import type { BBContact, BBMessage } from "./bb-types";
import type { FakeChatSeed, FakeSeed } from "./bluebubbles-fake";

const MINUTE = 60_000;

interface Person {
  readonly handle: string;
  readonly first: string;
  readonly last: string;
}

/** Cast of invented contacts. 555-01xx is the NANP "not a real number" block. */
const PEOPLE = {
  priya: { handle: "+15555550142", first: "Priya", last: "Raghunathan" },
  dmitri: { handle: "+15555550118", first: "Dmitri", last: "Volkov" },
  rosa: { handle: "+15555550125", first: "Rosa", last: "Delgado" },
  tomas: { handle: "+15555550163", first: "Tomás", last: "Ferreira" },
  nadia: { handle: "+15555550109", first: "Nadia", last: "Osei" },
  yuki: { handle: "+15555550177", first: "Yuki", last: "Tanaka" },
  marcus: { handle: "+15555550188", first: "Marcus", last: "Adeyemi" },
  sofia: { handle: "+15555550134", first: "Sofia", last: "Almeida" },
  ingrid: { handle: "+15555550151", first: "Ingrid", last: "Sørensen" },
  otto: { handle: "+15555550196", first: "Otto", last: "Brandt" },
  chen: { handle: "+15555550172", first: "Chen", last: "Wei" },
  amara: { handle: "+15555550115", first: "Amara", last: "Okonkwo" },
} as const satisfies Record<string, Person>;

type PersonKey = keyof typeof PEOPLE;

/** Chats the render script archives through the real API once the server is up. */
export const FIXTURE_ARCHIVED_GUIDS = [
  "iMessage;-;+15555550196",
  "iMessage;+;fixture-sublet",
  "iMessage;-;+15555550172",
] as const;

/** The group thread the desktop split-pane opens — several senders, tapbacks, a reply. */
export const FIXTURE_GROUP_THREAD_GUID = "iMessage;+;fixture-trip";
/** The DM the mobile capture pushes to, proving the list-then-thread stack. */
export const FIXTURE_DM_THREAD_GUID = "iMessage;-;+15555550142";

function contactOf(person: Person): BBContact {
  return {
    id: `fixture:${person.handle}`,
    phoneNumbers: [{ address: person.handle }],
    emails: [],
    firstName: person.first,
    lastName: person.last,
    sourceType: "fixture",
  };
}

export const FIXTURE_CONTACTS: BBContact[] = Object.values(PEOPLE).map(contactOf);

interface Turn {
  /** Minutes before `now`. Descending within a chat: the last entry is newest. */
  readonly agoMinutes: number;
  /** Absent only on tapback turns, which render as a reaction, not a bubble. */
  readonly text?: string;
  /** Omitted for outbound (from me). */
  readonly from?: PersonKey;
  /** Inbound messages without this are what make a chat Unread. */
  readonly read?: boolean;
  /** 1-indexed turn this reacts to; renders as a tapback, not a bubble. */
  readonly loves?: number;
  readonly laughs?: number;
  /** 1-indexed turn this is an inline reply to. */
  readonly replyTo?: number;
}

/**
 * Expands a chat's turn list into BlueBubbles wire messages. Tapback turns
 * become associated messages against their target's guid, exactly as Apple
 * sends them, so the thread builder folds them into reactions.
 */
function messages(chatId: string, turns: readonly Turn[], now: number): BBMessage[] {
  const guidOf = (index: number): string => `${chatId}-m${index + 1}`;
  return turns.map((turn, index): BBMessage => {
    const inbound = turn.from !== undefined;
    const person = turn.from ? PEOPLE[turn.from] : null;
    const base: BBMessage = {
      guid: guidOf(index),
      text: turn.text ?? null,
      dateCreated: now - turn.agoMinutes * MINUTE,
      isFromMe: !inbound,
      handle: person ? { address: person.handle } : null,
      // Outbound is always "read"; inbound only when the fixture says so, which
      // is what drives the unread counts the badges render.
      dateRead: !inbound || turn.read ? now - turn.agoMinutes * MINUTE + 30_000 : null,
      dateDelivered: now - turn.agoMinutes * MINUTE + 5_000,
    };
    const target = turn.loves ?? turn.laughs;
    if (target !== undefined) {
      return {
        ...base,
        text: null,
        associatedMessageGuid: `p:0/${guidOf(target - 1)}`,
        associatedMessageType: turn.loves !== undefined ? 2000 : 2003,
      };
    }
    if (turn.replyTo !== undefined) {
      return { ...base, threadOriginatorGuid: guidOf(turn.replyTo - 1), replyToGuid: guidOf(turn.replyTo - 1) };
    }
    return base;
  });
}

function dm(person: Person, turns: readonly Turn[], now: number): FakeChatSeed {
  const guid = `iMessage;-;${person.handle}`;
  return {
    guid,
    displayName: null,
    participants: [{ address: person.handle, service: "iMessage" }],
    messages: messages(guid.replace(/[^a-z0-9]/gi, ""), turns, now),
  };
}

function group(
  id: string,
  displayName: string,
  members: readonly PersonKey[],
  turns: readonly Turn[],
  now: number,
): FakeChatSeed {
  const guid = `iMessage;+;${id}`;
  return {
    guid,
    displayName,
    participants: members.map((key) => ({ address: PEOPLE[key].handle, service: "iMessage" })),
    messages: messages(id, turns, now),
  };
}

/**
 * The whole fixture directory, newest chat first. The mix is deliberate:
 *
 *   Unread      — trip group, Priya, book club, Rosa
 *   Unresponded — everything above plus Dmitri, Yuki, Sofia, Ingrid
 *   Waiting     — Tomás, Nadia, studio group, Marcus
 *   Archived    — Otto, the sublet group, Chen (applied via the API at boot)
 */
export function buildFixtureSeed(now: number = Date.now()): FakeSeed {
  const chats: FakeChatSeed[] = [
    group(
      "fixture-trip",
      "Cabin weekend 🏔",
      ["priya", "dmitri", "rosa"],
      [
        { agoMinutes: 320, from: "priya", read: true, text: "ok the cabin is booked. two nights, checkin friday 4pm" },
        { agoMinutes: 316, text: "legend. how far is it from the trailhead?" },
        { agoMinutes: 313, from: "priya", read: true, text: "twenty minutes, and the last stretch is gravel so nobody bring the low car" },
        { agoMinutes: 311, from: "dmitri", read: true, text: "that is directed at me and I accept it" },
        { agoMinutes: 310, from: "rosa", read: true, laughs: 4 },
        { agoMinutes: 302, from: "rosa", read: true, text: "I can drive, I've got room for three plus gear" },
        { agoMinutes: 298, text: "perfect. I'll do the food run saturday morning" },
        { agoMinutes: 295, from: "priya", read: true, loves: 7 },
        { agoMinutes: 240, from: "dmitri", read: true, text: "weather says rain saturday afternoon, clearing overnight" },
        { agoMinutes: 236, text: "fine by me, we can do the long hike sunday instead", replyTo: 9 },
        { agoMinutes: 96, from: "rosa", read: true, text: "does anyone have a spare headlamp? mine died" },
        { agoMinutes: 92, text: "I have two, bringing both" },
        { agoMinutes: 14, from: "priya", text: "one more thing — is anyone allergic to anything? doing the shopping list now" },
        { agoMinutes: 9, from: "dmitri", text: "shellfish, but I'll just eat around it" },
        { agoMinutes: 4, from: "priya", text: "noted. also who's on coffee duty because it is not going to be me at 6am" },
      ],
      now,
    ),
    dm(
      PEOPLE.priya,
      [
        { agoMinutes: 1450, from: "priya", read: true, text: "the venue got back to me, they can do the 14th but not the 7th" },
        { agoMinutes: 1444, text: "14th works. did they say anything about the sound guy?" },
        { agoMinutes: 1440, from: "priya", read: true, text: "included until 11, overtime after that is billed hourly" },
        { agoMinutes: 1435, text: "that's fine, we're not going past 11 anyway" },
        { agoMinutes: 400, from: "priya", read: true, text: "sent you the contract draft, section 4 is the one to actually read" },
        { agoMinutes: 380, text: "reading it now" },
        { agoMinutes: 60, from: "priya", read: true, text: "any thoughts? they want it back by friday" },
        { agoMinutes: 34, from: "priya", text: "also do you still have the floor plan from last time" },
        { agoMinutes: 22, from: "priya", text: "no rush on the floor plan, but the contract one is real" },
      ],
      now,
    ),
    dm(
      PEOPLE.dmitri,
      [
        { agoMinutes: 300, text: "did the part ever show up?" },
        { agoMinutes: 180, from: "dmitri", read: true, text: "arrived this morning, wrong size" },
        { agoMinutes: 64, from: "dmitri", read: true, text: "ordered the right one, should be here thursday. sorry for the delay" },
      ],
      now,
    ),
    group(
      "fixture-bookclub",
      "Thursday book club",
      ["sofia", "ingrid", "amara"],
      [
        { agoMinutes: 2900, from: "sofia", read: true, text: "reminder: we're on part two, chapters 9 through 16" },
        { agoMinutes: 2880, text: "I'm about four chapters behind, will catch up" },
        { agoMinutes: 600, from: "ingrid", read: true, text: "chapter 12 broke me a little bit, not going to lie" },
        { agoMinutes: 128, from: "amara", text: "moving thursday to 8pm — anyone object?" },
      ],
      now,
    ),
    dm(
      PEOPLE.tomas,
      [
        { agoMinutes: 1200, from: "tomas", read: true, text: "can you send the invoice with the new address on it" },
        { agoMinutes: 400, text: "sent, let me know if the tax line looks wrong" },
        { agoMinutes: 190, text: "also updated the payment terms to net 15 like you asked" },
      ],
      now,
    ),
    dm(
      PEOPLE.nadia,
      [
        { agoMinutes: 3000, from: "nadia", read: true, text: "the plumber can come tuesday between 10 and 2" },
        { agoMinutes: 2990, text: "tuesday works, I'll be home" },
        { agoMinutes: 305, text: "he came and went — leak's fixed, but the pressure in the shower is still low" },
      ],
      now,
    ),
    dm(
      PEOPLE.yuki,
      [
        { agoMinutes: 1500, text: "how did the talk go?" },
        { agoMinutes: 800, from: "yuki", read: true, text: "well! ran over by ten minutes but nobody left" },
        { agoMinutes: 430, from: "yuki", read: true, text: "they asked if I'd do a longer version in the fall. would you want to co-present?" },
      ],
      now,
    ),
    group(
      "fixture-studio",
      "Studio build-out",
      ["marcus", "rosa"],
      [
        { agoMinutes: 4000, from: "marcus", read: true, text: "acoustic panels arrive next week, we need somewhere to put them" },
        { agoMinutes: 3800, from: "rosa", read: true, text: "there's room along the back wall if we move the shelving" },
        { agoMinutes: 545, text: "I'll move the shelving this weekend. anyone got a stud finder" },
      ],
      now,
    ),
    dm(
      PEOPLE.rosa,
      [
        { agoMinutes: 2000, from: "rosa", read: true, text: "photos from saturday are up, link in a sec" },
        { agoMinutes: 1990, text: "the light in these is unreal" },
        { agoMinutes: 660, from: "rosa", text: "do you want the raws? they're big but the edit latitude is worth it" },
      ],
      now,
    ),
    dm(
      PEOPLE.marcus,
      [
        { agoMinutes: 2600, from: "marcus", read: true, text: "are we still on for the thing on the 20th" },
        { agoMinutes: 1500, text: "yes — 6pm, I'll bring the projector" },
      ],
      now,
    ),
    dm(
      PEOPLE.sofia,
      [
        { agoMinutes: 3400, text: "found that bakery you mentioned, the one on the corner" },
        { agoMinutes: 1700, from: "sofia", read: true, text: "the cardamom buns! did you get one" },
        { agoMinutes: 1690, text: "got three" },
        { agoMinutes: 1660, from: "sofia", read: true, text: "correct answer" },
      ],
      now,
    ),
    dm(
      PEOPLE.ingrid,
      [
        { agoMinutes: 5000, from: "ingrid", read: true, text: "I'm in town the week of the 12th if you're around" },
        { agoMinutes: 4800, text: "I'm around! dinner tuesday?" },
        { agoMinutes: 2880, from: "ingrid", read: true, text: "tuesday's good. pick somewhere with a patio" },
      ],
      now,
    ),
    dm(
      PEOPLE.otto,
      [
        { agoMinutes: 6000, from: "otto", read: true, text: "renewal quote came in higher than last year" },
        { agoMinutes: 5000, text: "shopped it around, found better. cancelling at the end of the term" },
      ],
      now,
    ),
    group(
      "fixture-sublet",
      "Sublet — 4B",
      ["chen", "amara"],
      [
        { agoMinutes: 9000, from: "chen", read: true, text: "is the room still available for july?" },
        { agoMinutes: 8000, text: "it went last week, sorry! I'll let you know if anything opens up" },
      ],
      now,
    ),
    dm(
      PEOPLE.chen,
      [
        { agoMinutes: 7000, text: "thanks for the referral, they got in touch" },
        { agoMinutes: 6200, from: "chen", read: true, text: "glad it worked out. tell them I said hi" },
      ],
      now,
    ),
  ];

  return { chats, contacts: FIXTURE_CONTACTS, privateApi: true };
}
