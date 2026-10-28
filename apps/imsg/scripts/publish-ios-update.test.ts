import { describe, expect, test } from "bun:test";

import { planIosRelease } from "./publish-ios-update";

const build = (id: string, status: string, hash: string | null) => ({
  id,
  status,
  fingerprint: hash ? { hash } : null,
});

describe("planIosRelease", () => {
  test("publishes OTA when a finished build carries the current runtime", () => {
    expect(planIosRelease("abc", [build("old", "FINISHED", "zzz"), build("b1", "FINISHED", "abc")]))
      .toEqual({ kind: "publish" });
  });

  test("waits on an in-flight build for the current runtime instead of starting another", () => {
    expect(planIosRelease("abc", [build("b2", "IN_QUEUE", "abc"), build("old", "FINISHED", "zzz")]))
      .toEqual({ kind: "wait", buildId: "b2" });
  });

  test("starts a build when no build matches, even if an older runtime finished or this one errored", () => {
    expect(planIosRelease("abc", [build("old", "FINISHED", "zzz"), build("bad", "ERRORED", "abc")]))
      .toEqual({ kind: "build" });
    expect(planIosRelease("abc", [build("legacy", "FINISHED", null)])).toEqual({ kind: "build" });
  });
});
