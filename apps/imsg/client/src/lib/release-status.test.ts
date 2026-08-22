import { describe, expect, test } from "bun:test";

import { clientReleaseBuild, createReleaseStatusStore } from "./release-status";

const RUNNING_WEB = "1111111111111111111111111111111111111111";
const DEPLOYED_WEB = "2222222222222222222222222222222222222222";

describe("client release build", () => {
  test("accepts the injected browser seam used by the desktop and visual fixture", () => {
    expect(clientReleaseBuild({
      __IMSG_RELEASE_BUILD__: {
        environment: "preview",
        branch: "feat/release-ui",
        webSha: RUNNING_WEB,
      },
    })).toEqual({
      environment: "preview",
      branch: "feat/release-ui",
      webSha: RUNNING_WEB,
    });
  });
});

describe("release status store", () => {
  test("publishes deployed web and local shell identity to all UI surfaces", () => {
    const store = createReleaseStatusStore({ environment: "production", branch: null, webSha: RUNNING_WEB });
    let changes = 0;
    const unsubscribe = store.subscribe(() => {
      changes += 1;
    });

    store.setDeployedWeb({ environment: "production", branch: null, webSha: DEPLOYED_WEB });
    store.setShell({ runningSha: RUNNING_WEB, stagedSha: DEPLOYED_WEB });

    expect(changes).toBe(2);
    expect(store.getSnapshot()).toEqual({
      running: { environment: "production", branch: null, webSha: RUNNING_WEB },
      deployedWeb: { environment: "production", branch: null, webSha: DEPLOYED_WEB },
      shell: { runningSha: RUNNING_WEB, stagedSha: DEPLOYED_WEB },
    });
    unsubscribe();
  });
});
