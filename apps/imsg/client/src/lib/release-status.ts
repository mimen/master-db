import {
  releaseBranch,
  releaseEnvironment,
  releaseSha,
  type ClientReleaseBuild,
  type DeployedWebRelease,
  type ReleaseIdentitySnapshot,
  type ShellReleaseState,
} from "@shared/release-identity";

export interface ReleaseBuildWindow {
  readonly __IMSG_RELEASE_BUILD__?: ClientReleaseBuild;
}

export interface ReleaseStatusStore {
  readonly getSnapshot: () => ReleaseIdentitySnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setDeployedWeb: (release: DeployedWebRelease) => void;
  readonly setShell: (shell: ShellReleaseState) => void;
}

function browserWindow(): ReleaseBuildWindow | undefined {
  if (typeof globalThis.window === "undefined") return undefined;
  return globalThis.window as Window & ReleaseBuildWindow;
}

export function clientReleaseBuild(
  win: ReleaseBuildWindow | undefined = browserWindow(),
): ClientReleaseBuild {
  if (win?.__IMSG_RELEASE_BUILD__) return win.__IMSG_RELEASE_BUILD__;
  return {
    environment: releaseEnvironment(process.env.EXPO_PUBLIC_IMSG_RELEASE_ENVIRONMENT) ?? "development",
    branch: releaseBranch(process.env.EXPO_PUBLIC_IMSG_RELEASE_BRANCH),
    webSha: releaseSha(process.env.EXPO_PUBLIC_IMSG_WEB_SHA),
  };
}

export function createReleaseStatusStore(running: ClientReleaseBuild): ReleaseStatusStore {
  let snapshot: ReleaseIdentitySnapshot = {
    running,
    deployedWeb: null,
    shell: { runningSha: null, stagedSha: null },
  };
  const listeners = new Set<() => void>();

  const publish = (next: ReleaseIdentitySnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setDeployedWeb: (deployedWeb) => publish({ ...snapshot, deployedWeb }),
    setShell: (shell) => publish({ ...snapshot, shell }),
  };
}

export const releaseStatus = createReleaseStatusStore(clientReleaseBuild());
