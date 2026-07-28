/**
 * Boots a throwaway imsg server backed by the render fixture.
 *
 * Everything about this process is disposable and sealed off: its Overlay DB,
 * HOME, and vault path all live in a temp directory that is deleted on exit, and
 * BB_URL points at a closed port so a misconfiguration surfaces as a failure
 * rather than as a connection to the real BlueBubbles. It never touches the
 * long-running service on the Mini — different port, different database.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_ARCHIVED_GUIDS } from "../server/render-fixture";

export const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Values the client bundle needs at export time but the fixture never calls. */
const FIXTURE_PUBLIC_ENV = {
  EXPO_PUBLIC_CONVEX_URL: "https://fixture.invalid",
  EXPO_PUBLIC_IMSG_IDENTITY_KEY: "fixture-render-key",
} as const;

export interface FixtureServer {
  readonly baseUrl: string;
  readonly logPath: string;
  stop(): Promise<void>;
}

/**
 * True when client/dist was exported with the fixture's public env baked in.
 *
 * The client has a real-data lane the BlueBubbles seam does not cover: the
 * Convex URL and identity key are compiled into the bundle at export time, so
 * reusing a normally-built dist would put a capture browser on a bundle holding
 * the real deployment. Nothing captured subscribes to it today, but that is one
 * `useQuery` away from real names in a fixture render, and it would fail
 * silently. So a reused bundle has to prove it is the fixture one.
 */
function isFixtureBuild(distDir: string): boolean {
  const entry = readdirSync(join(distDir, "_expo", "static", "js", "web"), { withFileTypes: true })
    .find((file) => file.isFile() && file.name.endsWith(".js"));
  if (!entry) return false;
  return readFileSync(join(distDir, "_expo", "static", "js", "web", entry.name), "utf8")
    .includes(FIXTURE_PUBLIC_ENV.EXPO_PUBLIC_CONVEX_URL);
}

/**
 * Exports the web client unless a fixture-built bundle is already there. The
 * export is the slow part of a render (a minute or so of Metro), so a bundle
 * that proves itself is reused.
 */
export async function ensureClientBuild(force: boolean): Promise<boolean> {
  const distDir = join(APP_ROOT, "client", "dist");
  const reusable = !force && existsSync(join(distDir, "index.html")) && isFixtureBuild(distDir);
  if (reusable) return false;

  const build = Bun.spawn(["bun", "run", "build:web"], {
    cwd: join(APP_ROOT, "client"),
    env: { ...process.env, ...FIXTURE_PUBLIC_ENV },
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await build.exited;
  if (code !== 0) throw new Error(`client build failed (exit ${code})`);
  if (!existsSync(join(distDir, "index.html"))) throw new Error(`client build produced no index.html in ${distDir}`);
  return true;
}

/**
 * Polls until the server we just spawned answers.
 *
 * `exited` is checked every pass because health alone cannot tell our child
 * from someone else's: a leaked server still holding the port answers /health
 * perfectly, and a run that captured against a stale orphan would look like a
 * pass while showing pre-edit code. If our child is gone, the port is lying.
 */
async function waitForHealth(
  baseUrl: string,
  timeoutMs: number,
  exited: Promise<number>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let dead: number | null = null;
  void exited.then((code) => {
    dead = code;
  });
  let lastError = "no attempt made";
  while (Date.now() < deadline) {
    if (dead !== null) {
      throw new Error(
        `fixture server exited (code ${dead}) before becoming healthy — ` +
          `is port ${new URL(baseUrl).port} already taken by a leaked run?`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean };
        if (body.ok === true) return;
        lastError = `health returned ${JSON.stringify(body)}`;
      } else {
        lastError = `health returned HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }
  throw new Error(`fixture server never became healthy: ${lastError}`);
}

/** Archived is Overlay-only state, so it is applied through the real API. */
async function applyOverlay(baseUrl: string): Promise<void> {
  for (const guid of FIXTURE_ARCHIVED_GUIDS) {
    const response = await fetch(`${baseUrl}/api/chats/${encodeURIComponent(guid)}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (!response.ok) throw new Error(`could not archive ${guid}: HTTP ${response.status}`);
  }
}

export async function startFixtureServer(port: number): Promise<FixtureServer> {
  const scratch = mkdtempSync(join(tmpdir(), "imsg-render-"));
  mkdirSync(join(scratch, "home"), { recursive: true });
  const logPath = join(scratch, "server.log");
  const log = Bun.file(logPath).writer();

  const server = Bun.spawn(["bun", "server/index.ts"], {
    cwd: APP_ROOT,
    env: {
      ...process.env,
      IMSG_FIXTURE: "1",
      PORT: String(port),
      DB_PATH: join(scratch, "render.db"),
      // Port 1 is never listening: the fixture must not reach a real server.
      BB_URL: "http://127.0.0.1:1",
      BB_PASSWORD: "fixture",
      // A scratch HOME covers the gateway key's DOTFILE path
      // (~/.cli-proxy-api-key); the env vars are the other half of
      // loadGatewayKey() and have to be cleared explicitly, or a machine
      // provisioned with the key in its environment renders with the AI
      // surfaces live. Empty string is deliberate: loadGatewayKey tests
      // truthiness, so "" falls through to the (now sealed) dotfile.
      HOME: join(scratch, "home"),
      AI_GATEWAY_KEY: "",
      CLAUDE_GPT_GATEWAY_API_KEY: "",
      AI_GATEWAY_URL: "http://127.0.0.1:1",
      // Full-history search reads Apple's chat.db directly, outside the
      // BlueBubbles seam entirely. homedir() is already redirected, but an
      // inherited CHATDB_PATH would point the fixture server at real history.
      CHATDB_PATH: join(scratch, "no-chatdb"),
      AI_VAULT_PATH: join(scratch, "vault"),
      AI_CCS_BIN: join(scratch, "no-ccs"),
      WHISPER_WORK_DIR: join(scratch, "whisper"),
      WHISPER_BINARY_PATH: "",
      WHISPER_MODEL_PATH: "",
      // The identity graph is opt-in; unset means the mirror and sync stay off.
      CONVEX_SITE_URL: "",
      CONVEX_CLOUD_URL: "",
      IMSG_IDENTITY_KEY: "",
      APPLE_CONTACTS_INGEST_SECRET: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  void (async (): Promise<void> => {
    for await (const chunk of server.stdout) log.write(chunk);
  })();
  void (async (): Promise<void> => {
    for await (const chunk of server.stderr) log.write(chunk);
  })();

  const baseUrl = `http://127.0.0.1:${port}`;
  const stop = async (): Promise<void> => {
    server.kill();
    await server.exited;
    await log.end();
    rmSync(scratch, { recursive: true, force: true });
  };

  try {
    await waitForHealth(baseUrl, 30_000, server.exited);
    await applyOverlay(baseUrl);
  } catch (error) {
    await log.flush();
    const tail = (await Bun.file(logPath).text().catch(() => "")).slice(-2000);
    await stop();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- server log ---\n${tail}`);
  }

  return { baseUrl, logPath, stop };
}
