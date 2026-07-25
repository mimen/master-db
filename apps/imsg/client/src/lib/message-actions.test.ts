import { describe, expect, test } from "bun:test";
import { appleMapsLocationUrl, faceTimeTargetUrl, webLocationBlockReason } from "./message-actions";

describe("FaceTime targets", () => {
  test("builds audio and video system URLs", () => {
    expect(faceTimeTargetUrl("+1 555 000 1111", "audio")).toBe(
      "facetime-audio://%2B1%20555%20000%201111",
    );
    expect(faceTimeTargetUrl("alex@example.com", "video")).toBe(
      "facetime://alex%40example.com",
    );
  });
});

describe("one-time location sharing", () => {
  test("builds an Apple Maps ll/q URL", () => {
    expect(appleMapsLocationUrl(37.3349, -122.00902)).toBe(
      "https://maps.apple.com/?ll=37.334900%2C-122.009020&q=Current+Location",
    );
  });

  test("explains insecure web origins while allowing HTTPS and localhost", () => {
    expect(webLocationBlockReason(false, "milads-mac-mini")).toContain("HTTPS");
    expect(webLocationBlockReason(true, "milads-mac-mini")).toBeNull();
    expect(webLocationBlockReason(false, "localhost")).toBeNull();
  });
});