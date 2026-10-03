import { describe, expect, test } from "bun:test";

import { crmSummary } from "./crm-summary";

describe("crmSummary", () => {
  test("lists only what is set, singular and plural", () => {
    expect(crmSummary({ isFavorite: true, priority: 1, tagCount: 2, eventCount: 1 })).toBe("Favorite · P1 · 2 tags · 1 event");
    expect(crmSummary({ isFavorite: false, priority: undefined, tagCount: 1, eventCount: 0 })).toBe("1 tag");
  });

  test("an empty record says so", () => {
    expect(crmSummary({ isFavorite: false, priority: undefined, tagCount: 0, eventCount: 0 })).toBe("Not set");
  });
});
