import { afterEach, expect, test, vi } from "vitest";

import { readCanonicalContacts } from "./canonicalContacts";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
test("canonical fetch fails closed on errors, malformed rows, and unrequested Humans", async () => {
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_TOKEN", "fixture");
  vi.stubEnv("AUF_CANONICAL_CONTACT_READ_URL", "https://fixture.convex.site/canonical-contacts/read");
  const id = "recAAAAAAAAAAAAAA";
  for (const response of [new Response("private upstream body", { status: 401 }), Response.json({ contacts: [{}] }),
    Response.json({ contacts: [{ humanId: "recBBBBBBBBBBBBBB", value: "other@example.test", channel: "email", primary: false }] })]) {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(readCanonicalContacts([id])).rejects.toThrow();
  }
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(readCanonicalContacts(Array(101).fill(id))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
