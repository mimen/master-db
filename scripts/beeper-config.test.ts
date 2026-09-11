import { describe, expect, it } from "vitest";

import { DEFAULT_BEEPER_URL, beeperSyncAccountError, resolveBeeperUrl } from "./beeper-config";

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

describe("beeperSyncAccountError", () => {
  it("refuses the iMessage bridge by network", () => {
    expect(beeperSyncAccountError({ accountID: "sh-imessage", network: "iMessage" })).toMatch(
      /refusing to mirror Apple Messages account "sh-imessage"/,
    );
  });

  it("refuses the BlueBubbles bridge whose network is unset", () => {
    expect(beeperSyncAccountError({ accountID: "sh-bluebubbles", network: null })).toMatch(
      /"sh-bluebubbles"/,
    );
  });

  it("allows WhatsApp", () => {
    expect(beeperSyncAccountError({ accountID: "whatsapp", network: "WhatsApp" })).toBeNull();
  });
});
