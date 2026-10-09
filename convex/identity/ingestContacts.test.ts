import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { ingestContactsBatch, ingestOneCard, type ContactCard } from "./ingestContacts";
import { ingestContactsBatchRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);

async function seedResolvedIdentity(
  t: TestConvex<typeof schema>,
  personId: Id<"people">,
  overrides: Partial<{ value: string; normalized: string; source: string }> = {},
): Promise<void> {
  const now = new Date().toISOString();
  await t.run((ctx) =>
    ctx.db.insert("identities", {
      person_id: personId,
      kind: "phone",
      value: overrides.value ?? "+16195551234",
      normalized: overrides.normalized ?? "+16195551234",
      network: overrides.source === "beeper" ? "whatsapp" : undefined,
      message_count: 0,
      chat_count: 0,
      is_self: false,
      source: overrides.source ?? "participant",
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    }),
  );
}

async function seedPerson(t: TestConvex<typeof schema>): Promise<Id<"people">> {
  const now = new Date().toISOString();
  return t.run((ctx) =>
    ctx.db.insert("people", {
      normalized_phones: [],
      normalized_emails: [],
      identity_count: 0,
      message_count: 0,
      is_self: false,
      auto_clustered: true,
      created_at: now,
      updated_at: now,
    }),
  );
}

describe("ingestOneCard: churn (regression for the every-10-minutes re-sync)", () => {
  test("ingesting the same unchanged card twice leaves updated_at unchanged on both the identity and the person", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = { display_name: "Chase", phones: ["6195551234"], emails: [] };

    const first = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(first.outcome).toBe("created");
    if (first.outcome !== "created") throw new Error("unreachable");

    const identityBefore = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "6195551234"))
        .first(),
    );
    const personBefore = await t.run((ctx) => ctx.db.get(first.personId));

    await new Promise((r) => setTimeout(r, 5));
    const second = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(second.outcome).toBe("reused");

    const identityAfter = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "6195551234"))
        .first(),
    );
    const personAfter = await t.run((ctx) => ctx.db.get(first.personId));

    expect(identityAfter?.updated_at).toBe(identityBefore?.updated_at);
    expect(personAfter?.updated_at).toBe(personBefore?.updated_at);
  });
});

describe("ingestOneCard: link_only", () => {
  test("a card matching no existing person is skipped when link_only is true", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = { display_name: "Nobody Yet", phones: ["6195551234"], emails: [] };
    const result = await t.run((ctx) => ingestOneCard(ctx, "airtable_human", card, true));
    expect(result.outcome).toBe("skipped_no_match");

    const people = await t.run((ctx) => ctx.db.query("people").collect());
    expect(people).toHaveLength(0);
  });

  test("a card matching an existing person still links when link_only is true", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await seedResolvedIdentity(t, personId, { value: "+16195551234", normalized: "+16195551234" });

    const card: ContactCard = { display_name: "Chase", phones: ["6195551234"], emails: [] };
    const result = await t.run((ctx) => ingestOneCard(ctx, "airtable_human", card, true));
    expect(result.outcome).toBe("reused");
    if (result.outcome !== "reused") throw new Error("unreachable");
    expect(result.personId).toBe(personId);
  });
});

describe("ingestOneCard: multi-handle grouping", () => {
  test("a card with two phones and an email that share no normalized key still produces one person", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = {
      display_name: "Chase",
      phones: ["6195551234", "8585559876"],
      emails: ["chase@example.com"],
    };
    const result = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");
    expect(result.identitiesWritten).toBe(3);

    const identities = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_person", (q) => q.eq("person_id", result.personId))
        .collect(),
    );
    expect(identities).toHaveLength(3);
    expect(new Set(identities.map((i) => i.person_id)).size).toBe(1);
  });
});

describe("ingestOneCard: cross-source linking", () => {
  test("a card's phone matching an existing identity's normalized value under a different source reuses that person", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await seedResolvedIdentity(t, personId, {
      value: "16195551234@s.whatsapp.net",
      normalized: "+16195551234",
      source: "beeper",
    });

    const card: ContactCard = { display_name: "Chase", phones: ["(619) 555-1234"], emails: [] };
    const result = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(result.outcome).toBe("reused");
    if (result.outcome !== "reused") throw new Error("unreachable");
    expect(result.personId).toBe(personId);

    const identities = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_person", (q) => q.eq("person_id", personId))
        .collect(),
    );
    expect(identities).toHaveLength(2);
  });
});

describe("ingestOneCard: no handles", () => {
  test("a card with no phones or emails is skipped", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = { display_name: "Empty", phones: [], emails: [] };
    const result = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(result.outcome).toBe("skipped_no_handles");
  });
});

describe("ingestOneCard: structured name parts", () => {
  test("writes first_name/last_name/nickname/source_contact_id onto every handle's identity row", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = {
      display_name: "Chase P.",
      first_name: "Chase",
      last_name: "Petersen",
      nickname: "Chasey",
      source_contact_id: "UUID-123:ABPerson",
      phones: ["6195551234"],
      emails: ["chase@example.com"],
    };
    const result = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("unreachable");

    const identities = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_person", (q) => q.eq("person_id", result.personId))
        .collect(),
    );
    expect(identities).toHaveLength(2);
    for (const i of identities) {
      expect(i.first_name).toBe("Chase");
      expect(i.last_name).toBe("Petersen");
      expect(i.nickname).toBe("Chasey");
      expect(i.source_contact_id).toBe("UUID-123:ABPerson");
    }
  });

  test("re-ingesting the identical card is a no-op on structured fields too (updated_at unchanged)", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = {
      display_name: "Chase P.",
      first_name: "Chase",
      last_name: "Petersen",
      nickname: "Chasey",
      source_contact_id: "UUID-123:ABPerson",
      phones: ["6195551234"],
      emails: [],
    };
    const first = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(first.outcome).toBe("created");
    const before = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "6195551234"))
        .first(),
    );

    await new Promise((r) => setTimeout(r, 5));
    const second = await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
    expect(second.outcome).toBe("reused");
    const after = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "6195551234"))
        .first(),
    );
    expect(after?.updated_at).toBe(before?.updated_at);
  });

  test("a card that omits first_name on re-ingest doesn't clear a previously-set value (blank never regresses)", async () => {
    const t = convexTest(schema, modules);
    const withName: ContactCard = {
      display_name: "Chase",
      first_name: "Chase",
      phones: ["6195551234"],
      emails: [],
    };
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", withName, false));

    const withoutName: ContactCard = { display_name: "Chase", phones: ["6195551234"], emails: [] };
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", withoutName, false));

    const identity = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "6195551234"))
        .first(),
    );
    expect(identity?.first_name).toBe("Chase");
  });

  test("a corrected non-blank value on re-ingest DOES update (new non-blank wins)", async () => {
    const t = convexTest(schema, modules);
    const original: ContactCard = { first_name: "Chace", phones: ["6195551234"], emails: [] };
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", original, false));

    const corrected: ContactCard = { first_name: "Chase", phones: ["6195551234"], emails: [] };
    await t.run((ctx) => ingestOneCard(ctx, "apple_contact", corrected, false));

    const identity = await t.run((ctx) =>
      ctx.db
        .query("identities")
        .withIndex("by_value", (q) => q.eq("value", "6195551234"))
        .first(),
    );
    expect(identity?.first_name).toBe("Chase");
  });
});

describe("ingestOneCard: a handle shared by two cards", () => {
  // Production: Tyler Chase's card carried Ramin Majlessi's email by mistake, and the shared
  // email's identity ended up with Ramin's display name and Tyler's first and last name.
  test("each sync writes the shared handle's name whole from one card, never spliced", async () => {
    const t = convexTest(schema, modules);
    const tyler: ContactCard = { display_name: "Tyler Chase", first_name: "Tyler", last_name: "Chase", source_contact_id: "TYLER:ABPerson", phones: ["8587509848"], emails: ["shared@example.com"] };
    const ramin: ContactCard = { display_name: "Ramin Majlessi", first_name: "Ramin", last_name: "Majlessi", source_contact_id: "RAMIN:ABPerson", phones: ["7608078355"], emails: ["shared@example.com"] };
    for (const card of [tyler, ramin, tyler, ramin]) {
      await t.run((ctx) => ingestOneCard(ctx, "apple_contact", card, false));
      const shared = await t.run((ctx) =>
        ctx.db.query("identities").withIndex("by_value", (q) => q.eq("value", "shared@example.com")).collect(),
      );
      for (const i of shared) {
        expect([i.display_name, i.first_name, i.last_name]).toEqual([card.display_name, card.first_name, card.last_name]);
      }
    }
  });
});

async function runBatch(ctx: MutationCtx, args: { source: string; contacts: ContactCard[] }): Promise<void> {
  const handler: unknown = Reflect.get(ingestContactsBatch, "_handler");
  if (typeof handler !== "function") throw new Error("ingestContactsBatch exposes no handler");
  const result: unknown = Reflect.apply(handler, undefined, [ctx, args]);
  await result;
}

const overlapping: ContactCard[] = [
  { display_name: "Tyler Chase", first_name: "Tyler", last_name: "Chase", source_contact_id: "T", phones: ["8587509848"], emails: ["shared@example.com"] },
  { display_name: "Ramin Majlessi", first_name: "Ramin", last_name: "Majlessi", source_contact_id: "R", phones: ["7608078355"], emails: ["shared@example.com"] },
  { display_name: "Chase", source_contact_id: "C1", phones: ["6195551234", "8585559876"], emails: ["chase@example.com"] },
  { display_name: "Chase Petersen", source_contact_id: "C2", phones: ["6195551234"], emails: ["chase.work@example.com"] },
  { display_name: "Xavier", source_contact_id: "X", phones: ["4155550003", "4155550001"], emails: [] },
  { display_name: "Yolanda", source_contact_id: "Y", phones: ["4155550002"], emails: [] },
  { display_name: "Yolanda Two", source_contact_id: "Y2", phones: ["4155550002", "4155550001"], emails: [] },
  { display_name: "Xavier", phones: ["4155550003"], emails: [] },
];

const walt: ContactCard = { display_name: "Walt", source_contact_id: "W", phones: ["3105550100"], emails: [] };
const waltRenamed: ContactCard = { ...walt, display_name: "Walter" };
const waltWithWork: ContactCard = { ...walt, phones: ["3105550100", "3105550101"] };

type Step = { cards: ContactCard[] } | { corrupt: string };

const steps: Step[] = [
  { cards: [...overlapping, walt] },
  { cards: [...overlapping, walt] },
  { cards: [walt, waltRenamed, walt, waltWithWork, walt] },
  { corrupt: "Walt" },
  { cards: [walt, walt] },
  { corrupt: "Chase Petersen" },
  { cards: overlapping },
];

async function snapshot(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const people = await ctx.db.query("people").collect();
    const index = new Map(people.map((p, i) => [p._id, i]));
    return {
      people: people.map(({ _id, _creationTime, ...p }) => p),
      identities: (await ctx.db.query("identities").collect()).map(({ _id, _creationTime, person_id, ...i }) => ({
        ...i,
        person: person_id && index.get(person_id),
      })),
    };
  });
}

async function playSteps(ingest: (ctx: MutationCtx, contacts: ContactCard[]) => Promise<void>) {
  const t = convexTest(schema, modules);
  const snapshots = [];
  for (const [n, step] of steps.entries()) {
    vi.setSystemTime(Date.UTC(2026, 0, 1, 0, n));
    if ("cards" in step) {
      await t.run((ctx) => ingest(ctx, step.cards));
    } else {
      await t.run(async (ctx) => {
        const person = (await ctx.db.query("people").collect()).find((p) => p.display_name === step.corrupt);
        if (!person) throw new Error(`no person named ${step.corrupt}`);
        await ctx.db.patch(person._id, { display_name: "Stale", normalized_phones: [], identity_count: 9 });
      });
    }
    snapshots.push(await snapshot(t));
  }
  return snapshots;
}

describe("ingestContactsBatch: parity with recomputing after every card", () => {
  afterEach(() => vi.useRealTimers());

  test("every row, including created_at and updated_at, matches after each step", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const everyCard = await playSteps(async (ctx, contacts) => {
      for (const card of contacts) await ingestOneCard(ctx, "apple_contact", card, false);
    });
    const batched = await playSteps((ctx, contacts) => runBatch(ctx, { source: "apple_contact", contacts }));

    expect(batched).toEqual(everyCard);
    const waltAfter = (step: number) => everyCard[step].people.find((p) => p.display_name === "Walt");
    expect(waltAfter(2)?.updated_at).toBe(new Date(Date.UTC(2026, 0, 1, 0, 2)).toISOString());
    expect(waltAfter(4)?.identity_count).toBe(2);
    expect(everyCard[0].people.find((p) => p.display_name === "Xavier")?.identity_count).toBe(1);
    expect(everyCard[6].people.find((p) => p.display_name === "Chase Petersen")?.identity_count).toBe(4);
  });

  test("counters cover first sync and replay", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(ingestContactsBatchRef, { source: "apple_contact", contacts: overlapping });
    const replay = await t.mutation(ingestContactsBatchRef, { source: "apple_contact", contacts: overlapping });
    expect([first, replay]).toEqual([
      { peopleCreated: 4, peopleReused: 4, identitiesWritten: 15, skippedNoHandles: 0, skippedNoMatch: 0 },
      { peopleCreated: 0, peopleReused: 8, identitiesWritten: 15, skippedNoHandles: 0, skippedNoMatch: 0 },
    ]);
  });
});

describe("ingestContactsBatch: an orphaned same-source row", () => {
  test("adopting it updates a person an earlier card already reconciled", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("identities", {
        kind: "email", value: "orphan@example.com", normalized: "orphan@example.com", message_count: 0, chat_count: 0, is_self: false,
        source: "apple_contact", first_seen_at: "2026-01-01", last_seen_at: "2026-01-01", created_at: "2026-01-01", updated_at: "2026-01-01",
      });
    });
    const cards: ContactCard[] = [
      { display_name: "Chase", phones: ["6195551234"], emails: [] },
      { display_name: "Chase", phones: ["6195551234"], emails: ["orphan@example.com"] },
    ];
    await t.mutation(ingestContactsBatchRef, { source: "apple_contact", contacts: cards });

    const people = await t.run((ctx) => ctx.db.query("people").collect());
    expect(people.map((p) => [p.identity_count, p.normalized_emails])).toEqual([[2, ["orphan@example.com"]]]);
  });
});

describe("ingestOneCard: a value listed twice on one card", () => {
  test("writes one identity row", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = { display_name: "Chase", phones: ["6195551234", "6195551234"], emails: [] };
    await t.mutation(ingestContactsBatchRef, { source: "apple_contact", contacts: [card] });
    const rows = await t.run((ctx) => ctx.db.query("identities").collect());
    expect(rows).toHaveLength(1);
  });
});

describe("ingestContactsBatch: read work", () => {
  async function countQueries(t: TestConvex<typeof schema>, ingest: (ctx: MutationCtx) => Promise<unknown>): Promise<number> {
    return t.run(async (ctx) => {
      const query = vi.spyOn(ctx.db, "query");
      await ingest(ctx);
      return query.mock.calls.length;
    });
  }

  test("a new card reads each handle's value once", async () => {
    const t = convexTest(schema, modules);
    const card: ContactCard = { display_name: "Chase", phones: ["6195551234", "8585559876"], emails: ["chase@example.com"] };
    expect(await countQueries(t, (ctx) => ingestOneCard(ctx, "apple_contact", card, false))).toBe(7);
  });

  test("a replayed batch recomputes a person shared by unchanged cards once", async () => {
    const t = convexTest(schema, modules);
    const personId = await seedPerson(t);
    await seedResolvedIdentity(t, personId, { value: "16195551234@s.whatsapp.net", normalized: "+16195551234", source: "beeper" });
    await seedResolvedIdentity(t, personId, { value: "18585559876@s.whatsapp.net", normalized: "+18585559876", source: "beeper" });
    const cards: ContactCard[] = [
      { display_name: "Chase", source_contact_id: "A", phones: ["6195551234"], emails: [] },
      { display_name: "Chase", source_contact_id: "B", phones: ["8585559876"], emails: [] },
    ];
    await t.mutation(ingestContactsBatchRef, { source: "apple_contact", contacts: cards });

    const everyCard = await countQueries(t, async (ctx) => {
      for (const card of cards) await ingestOneCard(ctx, "apple_contact", card, false);
    });
    const batched = await countQueries(t, (ctx) => runBatch(ctx, { source: "apple_contact", contacts: cards }));
    expect(everyCard - batched).toBe(1);
  });
});
