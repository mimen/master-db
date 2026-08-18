import { describe, expect, it, vi } from "vitest";

import {
  fetchBeeperAsset,
  type FetchImplementation,
  resolveBeeperAssetSource,
} from "./beeper-http";

describe("resolveBeeperAssetSource", () => {
  it("preserves mxc source URLs", () => {
    expect(
      resolveBeeperAssetSource(
        "mxc://local.beeper.com/id",
        "mxc://local.beeper.com/source",
      ),
    ).toBe("mxc://local.beeper.com/source");
  });

  it("uses the mxc id instead of a Mini-local file URL", () => {
    expect(
      resolveBeeperAssetSource(
        "mxc://local.beeper.com/id",
        "file:///Users/mimen/Library/Application Support/BeeperTexts/media/id",
      ),
    ).toBe("mxc://local.beeper.com/id");
  });
});

describe("fetchBeeperAsset", () => {
  it("streams an encoded mxc URL with bearer auth and an abort deadline", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async (input, init) => {
      expect(String(input)).toBe(
        "https://mini.example/v1/assets/serve?url=mxc%3A%2F%2Flocal.beeper.com%2Fabc%2B123",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer test-token",
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("asset-bytes", {
        headers: { "content-length": "11" },
      });
    });

    const asset = await fetchBeeperAsset(
      "https://mini.example/v1",
      "test-token",
      "mxc://local.beeper.com/abc+123",
      { attempts: 1, fetchImplementation },
    );

    expect(asset.contentLength).toBe(11);
    expect(await new Response(asset.body).text()).toBe("asset-bytes");
  });

  it("reports Beeper asset HTTP errors without exposing the token", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      new Response("missing", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      fetchBeeperAsset(
        "https://mini.example/v1",
        "secret-token",
        "mxc://local.beeper.com/missing",
        { attempts: 1, fetchImplementation },
      ),
    ).rejects.toThrow(
      "Beeper asset 404 Not Found for mxc://local.beeper.com/missing",
    );
  });

  it("retries failed remote requests with a fresh abort signal", async () => {
    const signals: AbortSignal[] = [];
    const fetchImplementation = vi.fn<FetchImplementation>(async (_input, init) => {
      if (init?.signal) signals.push(init.signal);
      throw new DOMException("timed out", "TimeoutError");
    });

    await expect(
      fetchBeeperAsset(
        "https://mini.example/v1",
        "test-token",
        "mxc://local.beeper.com/slow",
        {
          attempts: 2,
          fetchImplementation,
          sleep: async () => undefined,
          timeoutMs: 1,
        },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});
