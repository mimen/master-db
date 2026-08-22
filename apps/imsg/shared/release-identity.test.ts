import { describe, expect, test } from "bun:test";

import {
  displayReleaseSha,
  parseDeployedWebRelease,
  parseShellReleaseState,
  releaseSha,
  shellUpdateAvailable,
  webUpdateAvailable,
  type ReleaseIdentitySnapshot,
} from "./release-identity";

const RUNNING_WEB = "1111111111111111111111111111111111111111";
const DEPLOYED_WEB = "2222222222222222222222222222222222222222";
const RUNNING_SHELL = "3333333333333333333333333333333333333333";
const STAGED_SHELL = "4444444444444444444444444444444444444444";

function snapshot(): ReleaseIdentitySnapshot {
  return {
    running: { environment: "preview", branch: "feat/release-ui", webSha: RUNNING_WEB },
    deployedWeb: { environment: "preview", branch: "feat/release-ui", webSha: DEPLOYED_WEB },
    shell: { runningSha: RUNNING_SHELL, stagedSha: STAGED_SHELL },
  };
}

describe("release identity parsing", () => {
  test("normalizes valid SHAs and rejects labels masquerading as identity", () => {
    expect(releaseSha(` ${RUNNING_WEB.toUpperCase()} `)).toBe(RUNNING_WEB);
    expect(releaseSha("latest")).toBeNull();
    expect(releaseSha("abc123")).toBeNull();
  });

  test("parses the deployed web manifest contract", () => {
    expect(parseDeployedWebRelease({
      environment: "preview",
      branch: " feat/release-ui ",
      webSha: DEPLOYED_WEB,
    })).toEqual({
      environment: "preview",
      branch: "feat/release-ui",
      webSha: DEPLOYED_WEB,
    });
    expect(parseDeployedWebRelease({ environment: "prod", branch: null, webSha: DEPLOYED_WEB })).toBeNull();
  });

  test("parses nullable local shell state", () => {
    expect(parseShellReleaseState({ runningSha: RUNNING_SHELL, stagedSha: null })).toEqual({
      runningSha: RUNNING_SHELL,
      stagedSha: null,
    });
    expect(parseShellReleaseState({ runningSha: "broken", stagedSha: STAGED_SHELL })).toBeNull();
  });
});

describe("release activation decisions", () => {
  test("offers web activation only for a different SHA in the same deployment identity", () => {
    expect(webUpdateAvailable(snapshot())).toBe(true);
    expect(webUpdateAvailable({ ...snapshot(), deployedWeb: { ...snapshot().deployedWeb!, branch: "other" } })).toBe(false);
    expect(webUpdateAvailable({ ...snapshot(), deployedWeb: { ...snapshot().deployedWeb!, webSha: RUNNING_WEB } })).toBe(false);
    expect(webUpdateAvailable({ ...snapshot(), running: { ...snapshot().running, webSha: null } })).toBe(false);
  });

  test("offers shell activation only when a different staged shell exists", () => {
    expect(shellUpdateAvailable(snapshot())).toBe(true);
    expect(shellUpdateAvailable({ ...snapshot(), shell: { runningSha: RUNNING_SHELL, stagedSha: null } })).toBe(false);
    expect(shellUpdateAvailable({ ...snapshot(), shell: { runningSha: RUNNING_SHELL, stagedSha: RUNNING_SHELL } })).toBe(false);
  });

  test("formats compact Settings identities without inventing a SHA", () => {
    expect(displayReleaseSha(RUNNING_WEB)).toBe("111111111111");
    expect(displayReleaseSha(null)).toBe("—");
  });
});
