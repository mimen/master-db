import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { aufPath, aufReply, stubAuf } from "./aufFixture.vitest";
import { searchAirtableHumansRef } from "./testRefs.vitest";

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("search authorizes first and returns every canonical contact alongside primary display", async () => {
  vi.stubEnv("IMSG_SERVER_SECRET", "fixture-key");
  await stubAuf();
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "fixture-canonical-key");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
  const id = "recAAAAAAAAAAAAAA";
  const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const auf = aufPath(input, init);
    if (auf) {
      expect(auf).toEqual({ path: "commaIdentity:searchHumans", args: { query: "fixture" } });
      return aufReply([{ id, name: "Fixture", primaryPhone: "+16195550199", primaryEmail: "display@example.test" }]);
    }
    return Response.json({ contacts: [
      { humanId: id, channel: "email", value: "secondary@example.test", primary: false },
      { humanId: id, channel: "email", value: "display@example.test", primary: true },
      { humanId: id, channel: "sms", value: "+16195550198", primary: false },
      { humanId: id, channel: "sms", value: "+16195550199", primary: true },
    ], resolutions: [{ humanId: id, canonicalHumanId: id }] });
  });
  vi.stubGlobal("fetch", fetcher);
  const t = convexTest(schema, modules);
  await expect(t.action(searchAirtableHumansRef, { key: "wrong", query: "fixture" })).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(await t.action(searchAirtableHumansRef, { key: "fixture-key", query: "f" })).toEqual([]);
  const result = await t.action(searchAirtableHumansRef, { key: "fixture-key", query: "fixture" });
  expect(result).toEqual([{ record_id: id, display_name: "Fixture", phone: "+16195550199", email: "display@example.test",
    phones: ["+16195550199", "+16195550198"], emails: ["display@example.test", "secondary@example.test"] }]);
});
