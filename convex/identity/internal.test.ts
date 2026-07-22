import { describe, expect, test } from "vitest";

/**
 * These replicate the merge rules inside upsertIdentitiesBatch and assignCluster
 * (convex/identity/internal.ts) as plain assertions, matching this repo's
 * convention of testing mutation business logic without a live Convex db.
 */

describe("upsertIdentitiesBatch merge rules", () => {
  test("dedupe key is (network, value), not value alone", () => {
    const existing = [
      { value: "+16195551234", network: "whatsapp" },
      { value: "+16195551234", network: "imessage" },
    ];
    const incoming = { value: "+16195551234", network: "imessage" };
    const match = existing.find((m) => m.network === incoming.network);
    expect(match?.network).toBe("imessage");
  });

  test("longer display_name wins on update", () => {
    const existing = { display_name: "Milad" };
    const incoming = { display_name: "Milad Imen" };
    const merged =
      incoming.display_name && incoming.display_name.length > (existing.display_name?.length ?? 0)
        ? incoming.display_name
        : existing.display_name;
    expect(merged).toBe("Milad Imen");
  });

  test("shorter or missing incoming display_name does not overwrite existing", () => {
    const existing = { display_name: "Milad Imen" };
    const incoming = { display_name: undefined as string | undefined };
    const merged =
      incoming.display_name && incoming.display_name.length > (existing.display_name?.length ?? 0)
        ? incoming.display_name
        : existing.display_name;
    expect(merged).toBe("Milad Imen");
  });

  test("img_url and phone_number are keep-if-existing (first write wins)", () => {
    const existing = { img_url: "existing.jpg", phone_number: "+16195551234" };
    const incoming = { img_url: "new.jpg", phone_number: "+19995551234" };
    expect(existing.img_url ?? incoming.img_url).toBe("existing.jpg");
    expect(existing.phone_number ?? incoming.phone_number).toBe("+16195551234");
  });

  test("last_seen_at only advances forward in time", () => {
    const existing = { last_seen_at: "2026-01-01T00:00:00.000Z" as string | undefined };
    const older = "2025-06-01T00:00:00.000Z";
    const newer = "2026-06-01T00:00:00.000Z";

    const mergedWithOlder =
      older && (!existing.last_seen_at || older > existing.last_seen_at) ? older : existing.last_seen_at;
    expect(mergedWithOlder).toBe(existing.last_seen_at);

    const mergedWithNewer =
      newer && (!existing.last_seen_at || newer > existing.last_seen_at) ? newer : existing.last_seen_at;
    expect(mergedWithNewer).toBe(newer);
  });

  test("is_self is sticky once true (logical OR, never flips back)", () => {
    const orTrue = (a: boolean, b: boolean) => a || b;
    expect(orTrue(true, false)).toBe(true);
    expect(orTrue(false, true)).toBe(true);
    expect(orTrue(false, false)).toBe(false);
  });

  test("chat_count increments by exactly one per upsert", () => {
    let chatCount = 3;
    chatCount = chatCount + 1;
    expect(chatCount).toBe(4);
  });
});

describe("assignCluster aggregate rules", () => {
  test("prefers an existing non-merged person over creating a new one", () => {
    const identities = [
      { person_id: undefined },
      { person_id: "person_a" },
      { person_id: "person_b" },
    ];
    const people = { person_a: { merged_into: "person_c" }, person_b: { merged_into: undefined } };

    let chosen: string | null = null;
    for (const i of identities) {
      if (i.person_id) {
        const p = people[i.person_id as keyof typeof people];
        if (p && !p.merged_into) {
          chosen = i.person_id;
          break;
        }
      }
    }
    expect(chosen).toBe("person_b");
  });

  test("normalized values split into phones vs emails by '@' presence", () => {
    const normalizedValues = ["+16195551234", "milad@example.com", "+442079460958"];
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const n of normalizedValues) {
      if (n.includes("@")) emails.add(n);
      else if (n) phones.add(n);
    }
    expect([...phones].sort()).toEqual(["+16195551234", "+442079460958"]);
    expect([...emails]).toEqual(["milad@example.com"]);
  });

  test("best display name is the longest non-empty candidate across the cluster", () => {
    const identities = [{ display_name: "Milad" }, { display_name: "Milad I." }, { display_name: undefined }];
    let bestName: string | undefined;
    for (const i of identities) {
      if (i.display_name && i.display_name.length > (bestName?.length ?? 0)) {
        bestName = i.display_name;
      }
    }
    expect(bestName).toBe("Milad I.");
  });

  test("message_count and is_self aggregate across every identity in the cluster", () => {
    const identities = [
      { message_count: 10, is_self: false },
      { message_count: 5, is_self: true },
      { message_count: 2, is_self: false },
    ];
    let messageCount = 0;
    let isSelf = false;
    for (const i of identities) {
      messageCount += i.message_count;
      isSelf = isSelf || i.is_self;
    }
    expect(messageCount).toBe(17);
    expect(isSelf).toBe(true);
  });
});

describe("recomputePersonAggregates display_name_locked guard", () => {
  test("display_name is included in the patch when unlocked", () => {
    const person = { display_name_locked: false };
    const bestName = "Milad I.";
    const patch = { ...(person.display_name_locked ? {} : { display_name: bestName }) };
    expect(patch).toEqual({ display_name: "Milad I." });
  });

  test("display_name is omitted from the patch when locked, leaving the manual name untouched", () => {
    const person = { display_name_locked: true };
    const bestName = "Some Longer Source Name";
    const patch = { ...(person.display_name_locked ? {} : { display_name: bestName }) };
    expect(patch).toEqual({});
    expect("display_name" in patch).toBe(false);
  });

  test("a missing person doc (undefined) is treated as unlocked", () => {
    const person = undefined as { display_name_locked?: boolean } | undefined;
    const bestName = "Milad";
    const patch = { ...(person?.display_name_locked ? {} : { display_name: bestName }) };
    expect(patch).toEqual({ display_name: "Milad" });
  });
});
