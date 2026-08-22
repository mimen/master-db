import { readFile, rename, writeFile } from "node:fs/promises";

export function withBranchManifest(
  appFetch: (request: Request) => Response | Promise<Response>,
  manifestPath: string | null,
): (request: Request) => Promise<Response> {
  const recordActivity = manifestPath ? createActivityRecorder(manifestPath) : null;
  return async (request: Request): Promise<Response> => {
    if (recordActivity) await recordActivity();
    if (manifestPath && new URL(request.url).pathname === "/__comma/manifest") {
      const manifest = Bun.file(manifestPath);
      if (!(await manifest.exists())) return new Response("Branch manifest unavailable", { status: 503 });
      return new Response(manifest, {
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return appFetch(request);
  };
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
