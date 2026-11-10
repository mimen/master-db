import { readFileSync } from "node:fs";
import type { Hono } from "hono";

import {
  parseDeployedWebRelease,
  parseIosBuildRelease,
  type DeployedWebRelease,
  type IosBuildRelease,
} from "../shared/release-identity";

export function readDeployedWebRelease(path: string): DeployedWebRelease | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, string | null | undefined>;
    return parseDeployedWebRelease(value);
  } catch {
    return null;
  }
}

export function readIosBuildRelease(path: string): IosBuildRelease | null {
  try {
    return parseIosBuildRelease(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function registerDeployStatusRoute(app: Hono, manifestPath: string, iosManifestPath: string): void {
  app.get("/api/deploy/status", (c) => {
    const release = readDeployedWebRelease(manifestPath);
    return release ? c.json(release) : c.json({ error: "web release unavailable" }, 404);
  });
  app.get("/api/deploy/ios", (c) => {
    const release = readIosBuildRelease(iosManifestPath);
    return release ? c.json(release) : c.json({ error: "iOS build unavailable" }, 404);
  });
}
