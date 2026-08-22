import { describe, expect, test } from "bun:test";
import { deriveBranchIdentity } from "./branch-core";
import { tauriConfig } from "./desktop-config";

const identity = deriveBranchIdentity({
  branch: "feat/preview",
  worktreePath: "/tmp/master-db-preview",
  sha: "abcdef0123456789",
});

describe("Comma Dev Tauri config", () => {
  test("overrides every production-visible identity and URL", () => {
    const config = tauriConfig(identity, "https://mini.example:9001", "/tmp/icons");
    expect(config).toMatchObject({
      productName: "Comma Dev — feat-preview · f4a777",
      identifier: identity.bundleId,
      build: {
        devUrl: "https://mini.example:9001",
        frontendDist: "https://mini.example:9001",
      },
      app: {
        security: {
          capabilities: [
            "default",
            {
              identifier: `comma-preview-${identity.branchHash}`,
              local: false,
              windows: ["main"],
              remote: {
                urls: ["https://mini.example:9001", "https://mini.example:9001/**"],
              },
              permissions: expect.arrayContaining([
                "core:default",
                "core:window:allow-start-dragging",
                "opener:default",
              ]),
            },
          ],
        },
        windows: [{ title: identity.windowTitle }],
      },
      bundle: { icon: expect.arrayContaining(["/tmp/icons/icon.icns"]) },
    });
    expect(identity.bundleId).not.toBe("com.milad.imsg.desktop");
  });
});
