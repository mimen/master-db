import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "../schema";
import { normalizeModules } from "../test-utils.vitest";

import { airtableNameSearchFormula } from "./airtableSearch";
import { searchAirtableHumansRef } from "./testRefs.vitest";

describe("airtableNameSearchFormula", () => {
  test("wraps a plain name in a case-insensitive SEARCH", () => {
    expect(airtableNameSearchFormula("chase")).toBe("SEARCH(LOWER('chase'), LOWER({Name}))");
  });

  test("escapes a single quote so it can't break out of the formula string", () => {
    const formula = airtableNameSearchFormula("O'Brien");
    expect(formula).toBe("SEARCH(LOWER('O\\'Brien'), LOWER({Name}))");
    // The quote count inside the string literal must stay balanced.
    expect((formula.match(/(?<!\\)'/g) ?? []).length).toBe(2);
  });

  test("escapes a backslash before escaping quotes, so a trailing backslash can't eat the closing quote", () => {
    const formula = airtableNameSearchFormula("weird\\name");
    expect(formula).toContain("weird\\\\name");
  });

  test("a name containing formula-like syntax is treated as literal text, not executed", () => {
    const formula = airtableNameSearchFormula("x'), {Phone Number}='+1'");
    // The injected quote is escaped, so everything after it stays inside the string literal.
    expect(formula).toBe("SEARCH(LOWER('x\\'), {Phone Number}=\\'+1\\''), LOWER({Name}))");
  });
});

const modules = normalizeModules(import.meta.glob("../**/*.*s"), import.meta.url);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("search authorizes first and returns every canonical contact alongside primary display", async () => {
  vi.stubEnv("IMSG_SERVER_SECRET", "fixture-key");
  vi.stubEnv("AIRTABLE_API_KEY", "fixture-airtable-key");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "fixture-canonical-key");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
  const id = "recAAAAAAAAAAAAAA";
  const fetcher = vi.fn(async (input: string | URL) => {
    if (String(input).includes("api.airtable.com")) {
      const fields = new URL(String(input)).searchParams.getAll("fields[]");
      expect(fields).toEqual(["Name", "First Name", "Last Name", "Primary Phone", "Primary Email"]);
      return Response.json({ records: [{ id, fields: { Name: "Fixture", "Primary Phone": "+16195550199", "Primary Email": "display@example.test" } }] });
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
