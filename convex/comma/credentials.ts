import type { Infer } from "convex/values";

import type { sealedCredentials } from "../schema/comma/validators";

/**
 * Tokens at rest. `COMMA_TOKEN_KEY` is `<version>:<base64 of 32 random bytes>`; each sealed value records the version
 * it was sealed under, and the account it belongs to is the AES-GCM additional data, so a ciphertext copied onto
 * another account's row does not open. Runs only in actions: nothing a client reads ever holds a token.
 */

export type SealedCredentials = Infer<typeof sealedCredentials>;

// ponytail: one live key. Rotating means setting a new version and reconnecting each account; keep the old key beside
// the new one if reconnecting ever stops being cheap.
async function tokenKey(): Promise<{ version: number; key: CryptoKey }> {
  const [version, encoded] = (process.env.COMMA_TOKEN_KEY ?? "").split(":");
  const bytes = encoded ? Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)) : new Uint8Array();
  if (!version || !/^\d+$/.test(version) || bytes.length !== 32) throw new Error("COMMA_TOKEN_KEY must be <version>:<base64 of 32 bytes>");
  return { version: Number(version), key: await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]) };
}

const base64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unbase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** `boundTo` names the account, as `<platform>:<externalId>`. */
export async function sealCredentials(value: object, boundTo: string): Promise<SealedCredentials> {
  const { version, key } = await tokenKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(boundTo) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { keyVersion: version, iv: base64(iv), ciphertext: base64(new Uint8Array(ciphertext)) };
}

export async function openCredentials(sealed: SealedCredentials, boundTo: string): Promise<unknown> {
  const { version, key } = await tokenKey();
  if (sealed.keyVersion !== version) throw new Error(`Credentials were sealed under key ${sealed.keyVersion}; reconnect the account`);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(sealed.iv), additionalData: new TextEncoder().encode(boundTo) }, key, unbase64(sealed.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
