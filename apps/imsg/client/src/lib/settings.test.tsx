import { expect, test } from "bun:test";
import { parseSettings } from "./settings-values";

test.each([
  { dataSource: "server", convexSends: false },
  { dataSource: "convex", convexSends: true },
  { dataSource: "auto", convexSends: "auto" },
  { dataSource: "invalid", convexSends: 1 },
])("old settings keep preferences but discard routing overrides (%j)", (legacy) => {
  expect(parseSettings(JSON.stringify({
    ...legacy, suggestionMode: "on-demand", suggestionModel: "terra", nameOrder: "last-first",
  }))).toEqual({
    suggestionMode: "on-demand", suggestionModel: "terra", nameOrder: "last-first",
    theme: "system", openOn: "unresponded", groupBy: "last-message",
  });
});

test("missing and invalid preferences retain defaults", () => {
  for (const raw of ['{}', 'null', '{"suggestionMode":"invalid","nameOrder":42,"theme":"sepia","openOn":"settled","groupBy":"day"}']) {
    expect(parseSettings(raw)).toEqual({
      suggestionMode: "auto", suggestionModel: "opus", nameOrder: "first-last",
      theme: "system", openOn: "unresponded", groupBy: "last-message",
    });
  }
});

test("theme, open-on lens and grouping round-trip", () => {
  expect(parseSettings(JSON.stringify({ theme: "dark", openOn: "waiting", groupBy: "person" })))
    .toMatchObject({ theme: "dark", openOn: "waiting", groupBy: "person" });
  expect(parseSettings(JSON.stringify({ theme: "light", openOn: "all", groupBy: "none" })))
    .toMatchObject({ theme: "light", openOn: "all", groupBy: "none" });
});
