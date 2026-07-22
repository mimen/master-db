import type { Result } from "../bluebubbles";
import type { AiConfig } from "../config";

/**
 * The harness lane: shadow-conversation turns, routed through CCS.
 *
 * Per the managed-session-births contract, a daemon may not shell-launch nested
 * `claude` / `claude-gpt` processes. Instead we reserve one transcript-free
 * anchor session and hang every request off it as a synchronous delegated
 * child, so costs roll up to a single parent and each turn carries honest
 * automation provenance. `ccs delegate` preserves stdout and exit status, which
 * is what makes a request/response chat panel possible at all.
 *
 * A launched child is never retried automatically — the contract forbids it,
 * because the first process may already have changed state.
 */

const ANCHOR_KEY = "shadow_anchor_session_id";

export interface CommandSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (spec: CommandSpec) => Promise<ExecResult>;

export interface AnchorStore {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

/** Provenance every CCS invocation from this daemon must declare. */
export function automationEnv(creatorRef: string): Record<string, string> {
  if (!creatorRef.trim()) {
    // CCS rejects automation births without a stable ref; fail loudly here
    // rather than shipping a confusing error up from the CLI.
    throw new Error("AI_CREATOR_REF must be a stable, non-empty automation identity");
  }
  return { CCS_CREATOR_KIND: "automation", CCS_CREATOR_REF: creatorRef };
}

/** `ccs session new … --print-id`: reserves a managed id without launching. */
export function anchorCommand(config: AiConfig): CommandSpec {
  return {
    command: config.ccsBin,
    args: [
      "session",
      "new",
      "--top-level",
      "--cwd",
      config.shadowCwd,
      "--title",
      "imsg shadow conversation",
      "--print-id",
    ],
    env: automationEnv(config.creatorRef),
  };
}

/** One delegated turn against the anchor. Synchronous; stdout is the reply. */
export function delegateCommand(config: AiConfig, anchorId: string, prompt: string): CommandSpec {
  return {
    command: config.ccsBin,
    args: [
      "delegate",
      config.shadowSeat,
      "--child-of",
      anchorId,
      "--cwd",
      config.shadowCwd,
      "--prompt",
      prompt,
    ],
    env: automationEnv(config.creatorRef),
  };
}

export interface ShadowAvailability {
  available: boolean;
  detail: string | null;
}

/**
 * Whether the shadow lane can actually run, as opposed to whether the gateway
 * key merely exists. Cheap and side-effect-free: resolve the ccs binary and
 * confirm the seat directory is present. Meant to be called once at startup —
 * spawning ccs on every status poll would be wasteful.
 */
export function probeShadow(
  config: AiConfig,
  deps: { which: (bin: string) => string | null; seatExists: (dir: string) => boolean },
): ShadowAvailability {
  if (!config.gatewayKey) return { available: false, detail: "AI gateway key not configured" };
  if (!deps.which(config.ccsBin)) {
    return { available: false, detail: `ccs not found on PATH (AI_CCS_BIN=${config.ccsBin})` };
  }
  const seatDir = `${config.vaultPath}/ClaudeConfig/seats/${config.shadowSeat}`;
  if (!deps.seatExists(seatDir)) {
    return { available: false, detail: `seat "${config.shadowSeat}" not found — has it synced?` };
  }
  return { available: true, detail: null };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

/**
 * `--print-id` prints only the id, but shell wrappers and launchers are prone
 * to prepending noise, so extract rather than trusting the whole buffer.
 */
export function parseAnchorId(stdout: string): Result<string> {
  const match = stdout.match(UUID_RE);
  if (!match) return { ok: false, error: `no session id in output: ${stdout.slice(0, 120)}` };
  return { ok: true, value: match[0] };
}

export class ShadowRunner {
  constructor(
    private config: AiConfig,
    private store: AnchorStore,
    private exec: Exec,
  ) {}

  /**
   * Returns the persisted anchor, reserving one on first use. The id must
   * outlive restarts or cost rollup would fragment across many parents.
   */
  async ensureAnchor(): Promise<Result<string>> {
    const existing = this.store.get(ANCHOR_KEY);
    if (existing) return { ok: true, value: existing };

    let spec: CommandSpec;
    try {
      spec = anchorCommand(this.config);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    const result = await this.exec(spec);
    if (result.exitCode !== 0) {
      return { ok: false, error: `ccs session new failed (${result.exitCode}): ${result.stderr.trim()}` };
    }

    const parsed = parseAnchorId(result.stdout);
    if (!parsed.ok) return parsed;
    this.store.set(ANCHOR_KEY, parsed.value);
    return parsed;
  }

  /** One shadow turn. Never retries — see the contract note above. */
  async turn(prompt: string): Promise<Result<string>> {
    const anchor = await this.ensureAnchor();
    if (!anchor.ok) return anchor;

    const result = await this.exec(delegateCommand(this.config, anchor.value, prompt));
    if (result.exitCode !== 0) {
      return { ok: false, error: `ccs delegate failed (${result.exitCode}): ${result.stderr.trim()}` };
    }
    const reply = result.stdout.trim();
    if (!reply) return { ok: false, error: "delegate returned no output" };
    return { ok: true, value: reply };
  }
}

/** A delegated turn may use tools, but must not hang the panel forever. */
export const SHADOW_TIMEOUT_MS = 150_000;

/** Real process execution, used outside tests. Kills the child on timeout. */
export const spawnExec: Exec = async (spec) => {
  const proc = Bun.spawn([spec.command, ...spec.args], {
    env: { ...process.env, ...spec.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, SHADOW_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) {
      return { stdout: "", stderr: `timed out after ${SHADOW_TIMEOUT_MS / 1000}s`, exitCode: 124 };
    }
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
};
