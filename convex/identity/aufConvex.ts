/**
 * AUF's Convex, called on Comma's own token family. AUF trusts this issuer for two lanes:
 * `comma-guest-list` (the quick add's allocation top-up) and `comma-identity-read` (Humans names
 * and Events, AUF `convex/commaIdentity.ts`). The key is AUF_COMMA_JWT_PRIVATE_KEY.
 */

const AUF_ISSUER = "https://auf.network/comma";
const AUF_AUDIENCE = "auf-comma";
export type AufLane = "comma-guest-list" | "comma-identity-read";

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (value: object): string => b64url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * A one-minute RS256 token on AUF's comma issuer, signed with the PKCS#8 PEM key. Its `kid` is the
 * key's RFC 7638 thumbprint, the id AUF publishes for it, so a rotation changes only the key.
 */
export async function aufToken(pem: string, sub: AufLane, now = Date.now()): Promise<string> {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("pkcs8", der, algorithm, true, ["sign"]);
  const { n, e } = await crypto.subtle.exportKey("jwk", key);
  const kid = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ e, kty: "RSA", n })))));
  const iat = Math.floor(now / 1000);
  const body = `${b64urlJson({ alg: "RS256", typ: "JWT", kid })}.${b64urlJson({ iss: AUF_ISSUER, aud: AUF_AUDIENCE, sub, iat, exp: iat + 60 })}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

/** One AUF Convex function call on `lane`. Throws on a missing credential or any failure. */
export async function aufCall<T>(kind: "query" | "mutation" | "action", path: string, args: object, lane: AufLane): Promise<T> {
  const url = process.env.AUF_CONVEX_URL;
  const pem = process.env.AUF_COMMA_JWT_PRIVATE_KEY;
  if (!url || !pem) throw new Error("AUF_CONVEX_URL and AUF_COMMA_JWT_PRIVATE_KEY are not configured on this Convex deployment");
  const res = await fetch(`${url}/api/${kind}`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${await aufToken(pem, lane)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
    signal: AbortSignal.timeout(30000),
  });
  const result = (await res.json().catch(() => ({}))) as { status?: string; value?: T; errorMessage?: string };
  if (result.status !== "success" || result.value === undefined)
    throw new Error(`AUF ${path} failed: ${res.status} ${result.errorMessage ?? ""}`.trim());
  return result.value;
}

/** A read on Comma's identity lane. */
export const aufIdentityQuery = <T>(path: string, args: object): Promise<T> =>
  aufCall<T>("query", `commaIdentity:${path}`, args, "comma-identity-read");
