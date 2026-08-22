import { readFile, rename, writeFile } from "node:fs/promises";

export function withBranchManifest(
  appFetch: (request: Request) => Response | Promise<Response>,
  manifestPath: string | null,
): (request: Request) => Promise<Response> {
  const recordActivity = manifestPath ? createActivityRecorder(manifestPath) : null;
  return async (request: Request): Promise<Response> => {
    if (recordActivity) await recordActivity();
    const pathname = new URL(request.url).pathname;
    if (manifestPath && pathname === "/__comma/manifest") {
      const manifest = Bun.file(manifestPath);
      if (!(await manifest.exists())) return new Response("Branch manifest unavailable", { status: 503 });
      return new Response(manifest, {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (manifestPath && pathname === "/api/deploy/status") {
      return branchDeployStatus(manifestPath);
    }
    return appFetch(request);
  };
}

export async function branchDeployStatus(manifestPath: string): Promise<Response> {
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      branch?: string;
      sourceSha?: string;
    };
    if (!manifest.branch?.trim() || !/^[a-f0-9]{40}$/i.test(manifest.sourceSha ?? "")) {
      return Response.json({ error: "branch release unavailable" }, { status: 503 });
    }
    return Response.json({
      environment: "preview",
      branch: manifest.branch,
      webSha: manifest.sourceSha?.toLowerCase(),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "branch release unavailable" }, { status: 503 });
  }
}

export function createActivityRecorder(
  manifestPath: string,
  now: () => number = Date.now,
  intervalMs = 60_000,
): () => Promise<void> {
  let lastRecordedAt = 0;
  return async (): Promise<void> => {
    const timestamp = now();
    if (timestamp - lastRecordedAt < intervalMs) return;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { lastActivityAt?: string };
      manifest.lastActivityAt = new Date(timestamp).toISOString();
      const temporary = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
      await rename(temporary, manifestPath);
      lastRecordedAt = timestamp;
    } catch (error) {
      console.error(`Could not record scratch preview activity: ${String(error)}`);
    }
  };
}
