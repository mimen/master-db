import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { ingestOneCard, type ContactCard } from "./ingestContacts";

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
