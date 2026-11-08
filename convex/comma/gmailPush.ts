import { v } from "convex/values";

import { normalizeEmail } from "../../apps/imsg/shared/address";
import { internal } from "../_generated/api";
import { httpAction, internalMutation } from "../_generated/server";

import { siteUrl } from "./slackAuth";

/**
 * POST /comma/gmail/push: Gmail's users.watch publishes a mailbox change to a Pub/Sub topic, and an authenticated push
 * subscription posts it here with a Google-signed OIDC token. The handler checks the token's signature against
 * Google's keys, its issuer, audience, service-account email and expiry, then treats the message only as a nudge: it
 * schedules a history sync and answers at once, so Pub/Sub never retries a slow ack.
 */

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const CLOCK_SKEW_S = 60;

type Jwk = JsonWebKey & { kid: string };
let certs: { keys: Jwk[]; fetchedAt: number } | null = null;
const CERTS_TTL_MS = 60 * 60_000;

async function googleKey(kid: string): Promise<Jwk | undefined> {
  const fresh = certs && Date.now() - certs.fetchedAt < CERTS_TTL_MS ? certs : null;
  const cached = fresh?.keys.find((key) => key.kid === kid);
  if (cached) return cached;
  // A kid not in the cache may be a key Google rotated in since; read the keys again once.
  const response = await fetch(GOOGLE_CERTS);
  if (!response.ok) return undefined;
  certs = { keys: ((await response.json()) as { keys: Jwk[] }).keys, fetchedAt: Date.now() };
  return certs.keys.find((key) => key.kid === kid);
}

const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
const json = (text: string): Record<string, unknown> => JSON.parse(new TextDecoder().decode(fromBase64url(text))) as Record<string, unknown>;

/** The token's claims when Google signed it for this audience and service account, else null. */
export async function verifyGoogleOidc(token: string, expected: { audience: string; email: string }, nowSeconds: number): Promise<Record<string, unknown> | null> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  let head: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    head = json(header);
    claims = json(payload);
  } catch {
    return null;
  }
  if (head.alg !== "RS256" || typeof head.kid !== "string") return null;
  const jwk = await googleKey(head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { ...jwk, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromBase64url(signature), new TextEncoder().encode(`${header}.${payload}`));
  if (!signed) return null;
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  const iat = typeof claims.iat === "number" ? claims.iat : Infinity;
  if (!ISSUERS.has(String(claims.iss)) || claims.aud !== expected.audience || claims.email !== expected.email || claims.email_verified !== true) return null;
  if (exp + CLOCK_SKEW_S < nowSeconds || iat - CLOCK_SKEW_S > nowSeconds) return null;
  return claims;
}

/** The audience the push subscription is configured with: this endpoint's own URL. */
export const pushAudience = () => `${siteUrl()}/comma/gmail/push`;

export const handleGmailPush = httpAction(async (ctx, request) => {
  const email = process.env.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (!email) return new Response("GMAIL_PUSH_SERVICE_ACCOUNT is not set", { status: 500 });
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token || !(await verifyGoogleOidc(token, { audience: pushAudience(), email }, Math.floor(Date.now() / 1000)))) {
    return new Response("bad token", { status: 401 });
  }
  let emailAddress: string | undefined;
  try {
    const body = (await request.json()) as { message?: { data?: string } };
    const data = body.message?.data ? json(body.message.data) : {};
    emailAddress = typeof data.emailAddress === "string" ? data.emailAddress : undefined;
  } catch {
    emailAddress = undefined;
  }
  // A message Comma cannot read is acknowledged anyway: Pub/Sub would only redeliver it.
  if (emailAddress) await ctx.runMutation(internal.comma.gmailPush.receivePush, { emailAddress });
  return new Response(null, { status: 204 });
});

/** A nudge for a connected mailbox schedules its history sync. */
// ponytail: a burst of pushes schedules a sync each; they read the same history and write nothing twice. Coalesce if bursts cost.
export const receivePush = internalMutation({
  args: { emailAddress: v.string() },
  returns: v.null(),
  handler: async (ctx, { emailAddress }) => {
    const account = await ctx.db.query("comma_accounts")
      .withIndex("by_platform_externalId", (q) => q.eq("platform", "gmail").eq("externalId", normalizeEmail(emailAddress))).unique();
    if (account?.credentials) await ctx.scheduler.runAfter(0, internal.comma.gmailSync.sync, { accountId: account._id });
    return null;
  },
});
