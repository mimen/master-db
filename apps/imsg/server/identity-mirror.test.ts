import { afterEach, describe, expect, test } from "bun:test";
import { IdentityMirror } from "./identity-mirror";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(response: unknown, ok = true, status = 200): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok,
      status,
      json: () => Promise.resolve(response),
    })) as unknown as typeof fetch;
}

describe("IdentityMirror", () => {
  test("unconfigured: refresh is a no-op, lookup always misses", async () => {
    const mirror = new IdentityMirror({ convexCloudUrl: null, identityKey: null });
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.reject(new Error("should not be called"));
    }) as unknown as typeof fetch;
    await mirror.refresh();
    expect(called).toBe(false);
    expect(mirror.lookup("+16266522285")).toBeNull();
  });

  test("builds the map from a successful query and looks up a raw address via the shared match key", async () => {
    stubFetch({
      status: "success",
      value: [{ normalized: "+16266522285", display_name: "Alex", terms: ["alex"] }],
    });
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    // Raw, differently-formatted address finds the entry stored from the
    // normalized value — both sides run through phoneMatchKey/emailMatchKey.
    expect(mirror.lookup("(626) 652-2285")).toBe("Alex");
    expect(mirror.lookup("+16266522285")).toBe("Alex");
  });

  test("email entries match case-insensitively", async () => {
    stubFetch({
      status: "success",
      value: [{ normalized: "alex@example.com", display_name: "Alex", terms: ["alex"] }],
    });
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.lookup("ALEX@EXAMPLE.COM")).toBe("Alex");
  });

  test("miss returns null", async () => {
    stubFetch({ status: "success", value: [] });
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.lookup("+15550001111")).toBeNull();
  });

  test("a failed refresh keeps the last good snapshot instead of going blank", async () => {
    stubFetch({
      status: "success",
      value: [{ normalized: "+16266522285", display_name: "Alex", terms: ["alex"] }],
    });
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.lookup("+16266522285")).toBe("Alex");

    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    await mirror.refresh();
    expect(mirror.lookup("+16266522285")).toBe("Alex");
  });

  test("a non-200 response leaves the previous snapshot untouched", async () => {
    stubFetch({
      status: "success",
      value: [{ normalized: "+16266522285", display_name: "Alex", terms: ["alex"] }],
    });
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();

    stubFetch({}, false, 500);
    await mirror.refresh();
    expect(mirror.lookup("+16266522285")).toBe("Alex");
  });

  test("a Convex error envelope leaves the previous snapshot untouched", async () => {
    stubFetch({
      status: "success",
      value: [{ normalized: "+16266522285", display_name: "Alex", terms: ["alex"] }],
    });
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();

    stubFetch({ status: "error", errorMessage: "Unauthorized" });
    await mirror.refresh();
    expect(mirror.lookup("+16266522285")).toBe("Alex");
  });
});

describe("IdentityMirror searchTerms / search", () => {
  // The Jimmy Sciandra scenario: renamed in-app to "Uncle Jimmy", but still
  // findable by his old first/last name via the raw "(626) 652-2285" style
  // lookup used throughout this test file.
  function jimmyFixture() {
    return {
      status: "success" as const,
      value: [
        {
          normalized: "+16266522285",
          display_name: "Uncle Jimmy",
          terms: ["uncle jimmy", "jimmy", "sciandra", "jimmy sciandra"],
        },
        { normalized: "+15550002222", display_name: "Karely", terms: ["karely"] },
      ],
    };
  }

  test("searchTerms returns the matched person's full term list via the match-key seam", async () => {
    stubFetch(jimmyFixture());
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.searchTerms("(626) 652-2285")).toEqual([
      "uncle jimmy",
      "jimmy",
      "sciandra",
      "jimmy sciandra",
    ]);
  });

  test("searchTerms is [] on a miss", async () => {
    stubFetch(jimmyFixture());
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.searchTerms("+15559998888")).toEqual([]);
  });

  test("search finds a renamed person by their OLD first/last name", async () => {
    stubFetch(jimmyFixture());
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    const bySciandra = mirror.search("sciandra", 25);
    expect(bySciandra).toEqual([{ address: "6266522285", name: "Uncle Jimmy" }]);
    const byFirst = mirror.search("jimmy sciandra", 25);
    expect(byFirst).toEqual([{ address: "6266522285", name: "Uncle Jimmy" }]);
  });

  test("search finds the person by their current nickname/display too", async () => {
    stubFetch(jimmyFixture());
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.search("uncle", 25)).toEqual([{ address: "6266522285", name: "Uncle Jimmy" }]);
  });

  test("search is case-insensitive, trims the query, and respects the limit", async () => {
    stubFetch(jimmyFixture());
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.search("  JIMMY  ", 25)).toEqual([{ address: "6266522285", name: "Uncle Jimmy" }]);
    expect(mirror.search("jimmy", 0)).toEqual([]);
  });

  test("search on a blank query returns []", async () => {
    stubFetch(jimmyFixture());
    const mirror = new IdentityMirror({ convexCloudUrl: "https://x.convex.cloud", identityKey: "k" });
    await mirror.refresh();
    expect(mirror.search("   ", 25)).toEqual([]);
  });
});
