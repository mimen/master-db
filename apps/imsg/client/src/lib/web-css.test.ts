import { describe, expect, mock, test } from "bun:test";

mock.module("react-native", () => ({ Platform: { OS: "web", select: (o: { web?: unknown; default?: unknown }) => o.web ?? o.default } }));
mock.module("@/global.css", () => ({}));

const { GLOBAL_WEB_CSS } = await import("./web-css");

describe("GLOBAL_WEB_CSS", () => {
  test("draws an accent focus ring for keyboard focus in both schemes", () => {
    expect(GLOBAL_WEB_CSS).toContain(":focus-visible{outline:2px solid #007AFF;outline-offset:2px}");
    expect(GLOBAL_WEB_CSS).toContain("@media (prefers-color-scheme:dark){:focus-visible{outline-color:#0A84FF}}");
  });

  test("never suppresses focus-visible globally", () => {
    expect(GLOBAL_WEB_CSS).not.toContain("*:focus-visible");
    expect(GLOBAL_WEB_CSS).not.toContain("box-shadow:none");
  });
});
