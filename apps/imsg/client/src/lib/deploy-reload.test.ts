import { describe, expect, test } from "bun:test";

import {
  DEPLOYED_WEB_RELEASE_PATH,
  deployedWebReleaseFromJson,
  fetchDeployedWebRelease,
  installWebReleaseMonitor,
  reloadWebClient,
  type DeployMonitorDocument,
} from "./deploy-reload";

const DEPLOYED_WEB = "2222222222222222222222222222222222222222";

function visibleDocument(): DeployMonitorDocument {
  return {
    visibilityState: "visible",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

describe("deployed web release", () => {
  test("parses the strict backend manifest", () => {
    expect(deployedWebReleaseFromJson(JSON.stringify({
      environment: "production",
      branch: null,
      webSha: DEPLOYED_WEB,
    }))).toEqual({ environment: "production", branch: null, webSha: DEPLOYED_WEB });
    expect(deployedWebReleaseFromJson("<html></html>")).toBeNull();
    expect(deployedWebReleaseFromJson(JSON.stringify({ environment: "production", webSha: "latest" }))).toBeNull();
  });

  test("requests the no-cache deployment status seam", async () => {
    let requested = "";
    const release = await fetchDeployedWebRelease(async (path) => {
      requested = path;
      return {
        ok: true,
        text: async () => JSON.stringify({ environment: "production", branch: null, webSha: DEPLOYED_WEB }),
      };
    });
    expect(requested).toBe(DEPLOYED_WEB_RELEASE_PATH);
    expect(release?.webSha).toBe(DEPLOYED_WEB);
  });
});

describe("installWebReleaseMonitor", () => {
  test("reports a deployed release without reloading the page", async () => {
    const releases: string[] = [];
    const uninstall = installWebReleaseMonitor({
      document: visibleDocument(),
      fetchRelease: async () => ({ environment: "production", branch: null, webSha: DEPLOYED_WEB }),
      onRelease: (release) => releases.push(release.webSha),
      intervalMs: 60_000,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toEqual([DEPLOYED_WEB]);
    uninstall();
  });

  test("reload is a separate explicit activation action", () => {
    let reloads = 0;
    reloadWebClient(() => {
      reloads += 1;
    });
    expect(reloads).toBe(1);
  });
});
