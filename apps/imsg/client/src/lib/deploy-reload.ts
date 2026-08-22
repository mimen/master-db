import {
  parseDeployedWebRelease,
  type DeployedWebRelease,
} from "@shared/release-identity";

export const DEPLOYED_WEB_RELEASE_PATH = "/api/deploy/status";

export interface DeployMonitorDocument {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface WebReleaseMonitorHost {
  readonly document: DeployMonitorDocument;
  readonly fetchRelease: () => Promise<DeployedWebRelease | null>;
  readonly onRelease: (release: DeployedWebRelease) => void;
  readonly intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 45_000;

export function deployedWebReleaseFromJson(json: string): DeployedWebRelease | null {
  try {
    const value = JSON.parse(json) as Record<string, string | null | undefined>;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return parseDeployedWebRelease(value);
  } catch {
    return null;
  }
}

export async function fetchDeployedWebRelease(
  request: (path: string) => Promise<{ readonly ok: boolean; text(): Promise<string> }>,
): Promise<DeployedWebRelease | null> {
  const response = await request(DEPLOYED_WEB_RELEASE_PATH);
  if (!response.ok) return null;
  return deployedWebReleaseFromJson(await response.text());
}

/**
 * Polls deployed identity without activating it. A release mismatch stays visible
 * until the user explicitly reloads, so focused composers and unsaved drafts are
 * never discarded by a deploy timer.
 */
export function installWebReleaseMonitor(host: WebReleaseMonitorHost): () => void {
  const intervalMs = host.intervalMs ?? DEFAULT_INTERVAL_MS;
  let cancelled = false;
  let inFlight = false;

  const check = (): void => {
    if (cancelled || inFlight) return;
    inFlight = true;
    void host.fetchRelease()
      .then((release) => {
        if (!cancelled && release) host.onRelease(release);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  const onVisible = (): void => {
    if (host.document.visibilityState === "visible") check();
  };

  host.document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(check, intervalMs);
  check();

  return () => {
    cancelled = true;
    host.document.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
}

export function reloadWebClient(reload: () => void = () => globalThis.window.location.reload()): void {
  reload();
}
