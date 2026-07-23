export interface Config {
  bbUrl: string;
  bbPassword: string;
  port: number;
  dbPath: string;
  /** Convex .convex.site URL for the identity-graph ingest route. Optional — contact sync is skipped if unset. */
  convexSiteUrl: string | null;
  /** Bearer secret for POST /identity/ingest-contacts. Optional — contact sync is skipped if unset. */
  appleContactsIngestSecret: string | null;
  /**
   * Convex .convex.cloud URL (the HTTP query API), used by the identity
   * mirror to pull the name directory. Distinct from convexSiteUrl above —
   * that's the .convex.site URL for the identity-sync ingest HTTP action.
   * Optional — the mirror is skipped if unset.
   */
  convexCloudUrl: string | null;
  /** Shared key for identity/queries.ts's requireIdentityKey gate. Optional — the mirror is skipped if unset. */
  identityKey: string | null;
  ai: AiConfig;
}

export interface AiConfig {
  /** Local CLIProxyAPI gateway; Anthropic-messages shaped, GPT models behind it. */
  gatewayUrl: string;
  /** Empty string disables the AI surfaces rather than crashing the server. */
  gatewayKey: string;
  /** Fast-lane model for suggestions. Effort suffix is part of the id. */
  fastModel: string;
  /** Vault root, read for the profile blob and contact candidates. */
  vaultPath: string;
  /** Stable automation identity for CCS provenance. */
  creatorRef: string;
  /**
   * How to invoke ccs. launchd hands a process a bare PATH that excludes
   * ~/.bun/bin, so a plain "ccs" resolves interactively but not under the
   * service that actually runs this server — hence an overridable absolute path.
   */
  ccsBin: string;
  /** Seat used for shadow-conversation delegate turns. */
  shadowSeat: string;
  /** Absolute cwd handed to ccs for delegated turns. */
  shadowCwd: string;
}

function required(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * The gateway key lives in an env var on machines provisioned by the Machine
 * Adapter, and in a dotfile on older ones. Read either; an absent key disables
 * the AI surfaces instead of failing startup, so the rest of the app still runs.
 */
function loadGatewayKey(): string {
  const fromEnv = Bun.env.AI_GATEWAY_KEY ?? Bun.env.CLAUDE_GPT_GATEWAY_API_KEY;
  if (fromEnv) return fromEnv.trim();
  const home = Bun.env.HOME;
  if (!home) return "";
  try {
    return require("node:fs").readFileSync(`${home}/.cli-proxy-api-key`, "utf8").trim();
  } catch {
    return "";
  }
}

export function loadConfig(): Config {
  const home = Bun.env.HOME ?? "";
  return {
    bbUrl: (Bun.env.BB_URL ?? "http://localhost:1234").replace(/\/$/, ""),
    bbPassword: required("BB_PASSWORD"),
    port: Number(Bun.env.PORT ?? 8377),
    dbPath: Bun.env.DB_PATH ?? "imsg.db",
    convexSiteUrl: Bun.env.CONVEX_SITE_URL?.replace(/\/$/, "") ?? null,
    appleContactsIngestSecret: Bun.env.APPLE_CONTACTS_INGEST_SECRET ?? null,
    convexCloudUrl: Bun.env.CONVEX_CLOUD_URL?.replace(/\/$/, "") ?? null,
    identityKey: Bun.env.IMSG_IDENTITY_KEY ?? null,
    ai: {
      gatewayUrl: (Bun.env.AI_GATEWAY_URL ?? "http://127.0.0.1:8317").replace(/\/$/, ""),
      gatewayKey: loadGatewayKey(),
      fastModel: Bun.env.AI_FAST_MODEL ?? "gpt-5.6-luna(low)",
      vaultPath: Bun.env.AI_VAULT_PATH ?? `${home}/Documents/milad-vault`,
      creatorRef: Bun.env.AI_CREATOR_REF ?? "imsg-shadow",
      ccsBin: Bun.env.AI_CCS_BIN ?? "ccs",
      shadowSeat: Bun.env.AI_SHADOW_SEAT ?? "imsg-shadow",
      shadowCwd: Bun.env.AI_SHADOW_CWD ?? process.cwd(),
    },
  };
}
