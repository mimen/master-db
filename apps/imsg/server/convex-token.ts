import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import type { Hono } from "hono";

import type { Config } from "./config";

// Declared locally: importing @convex-dev/auth/server pulls its DOM-flavoured
// types into the server project and breaks unrelated BodyInit call sites.
type Tokens = { token: string; refreshToken: string };
type SignInAction = FunctionReference<
  "action",
  "public",
  { provider: string; params: { secret: string } } | { refreshToken: string },
  { tokens?: Tokens | null }
>;

export type ConvexAuthClient = {
  action: (reference: SignInAction, args: FunctionArgs<SignInAction>) => Promise<FunctionReturnType<SignInAction>>;
};

const signIn: SignInAction = makeFunctionReference("auth:signIn");
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

function tokenExpiry(token: string): number {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid Convex token");
  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (typeof claims !== "object" || claims === null || !("exp" in claims)
    || typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
    throw new Error("Invalid Convex token expiry");
  }
  return claims.exp * 1000;
}

export function registerConvexTokenRoute(
  app: Hono,
  config: Pick<Config, "convexCloudUrl" | "commaBridgeSecret">,
  deps: { client?: ConvexAuthClient; now?: () => number } = {},
): void {
  const client = deps.client ?? (config.convexCloudUrl ? new ConvexHttpClient(config.convexCloudUrl) : null);
  const now = deps.now ?? Date.now;
  let session: (Tokens & { expiresAt: number }) | null = null;
  let inFlight: Promise<string> | null = null;

  function store(result: FunctionReturnType<SignInAction>): string {
    if (!result.tokens) throw new Error("Convex did not issue a session");
    const expiresAt = tokenExpiry(result.tokens.token);
    if (!Number.isFinite(expiresAt) || expiresAt <= now()) throw new Error("Convex issued an invalid token expiry");
    session = { ...result.tokens, expiresAt };
    return result.tokens.token;
  }

  app.get("/api/convex-token", async (c) => {
    c.header("Cache-Control", "no-store");
    const secret = config.commaBridgeSecret;
    if (!config.convexCloudUrl || !secret || !client) {
      return c.json({ error: "Convex session unavailable" }, 503);
    }
    try {
      if (!inFlight && (c.req.query("refresh") === "1" || !session || session.expiresAt - now() <= REFRESH_MARGIN_MS)) {
        const previous = session;
        session = null;
        inFlight = (async () => {
          if (previous) {
            try {
              return store(await client.action(signIn, { refreshToken: previous.refreshToken }));
            } catch {
              return store(await client.action(signIn, { provider: "tailnet", params: { secret } }));
            }
          }
          return store(await client.action(signIn, { provider: "tailnet", params: { secret } }));
        })().finally(() => { inFlight = null; });
      }
      const token = inFlight ? await inFlight : session?.token;
      if (!token) throw new Error("Convex session unavailable");
      return c.json({ token });
    } catch {
      return c.json({ error: "Convex session unavailable" }, 503);
    }
  });
}
