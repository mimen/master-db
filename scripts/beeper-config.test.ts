import { describe, expect, it } from "vitest";

import { DEFAULT_BEEPER_URL, resolveBeeperUrl } from "./beeper-config";

describe("resolveBeeperUrl", () => {
  it("uses the Mini Tailscale endpoint when BEEPER_URL is unset", () => {
    expect(resolveBeeperUrl(undefined)).toBe(DEFAULT_BEEPER_URL);
  });

  it("uses the Mini Tailscale endpoint when BEEPER_URL is blank", () => {
    expect(resolveBeeperUrl("  ")).toBe(DEFAULT_BEEPER_URL);
  });

  it("uses and normalizes a configured BEEPER_URL", () => {
    expect(resolveBeeperUrl(" https://beeper.example/v1/ ")).toBe(
      "https://beeper.example/v1",
    );
  });
});
