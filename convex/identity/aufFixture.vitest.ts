import { vi } from "vitest";

/** The AUF Convex origin tests point AUF_CONVEX_URL at. */
export const AUF = "https://fixture-auf.convex.cloud";

let pem: Promise<string> | undefined;
/** A throwaway PKCS#8 key, made once per test file. */
function fixturePem(): Promise<string> {
  pem ??= crypto.subtle
    .generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])
    .then(async (pair) => {
      const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
      return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
    });
  return pem;
}

/** Points the AUF calls at the fixture origin with a throwaway key. */
export async function stubAuf(): Promise<void> {
  vi.stubEnv("AUF_CONVEX_URL", AUF);
  vi.stubEnv("AUF_COMMA_JWT_PRIVATE_KEY", await fixturePem());
}

/** The AUF function a fixture request calls, or null for any other URL. */
export function aufPath(input: string | URL, init?: RequestInit): { path: string; args: Record<string, unknown> } | null {
  if (!String(input).startsWith(`${AUF}/api/`)) return null;
  const { path, args } = JSON.parse(String(init?.body)) as { path: string; args: Record<string, unknown> };
  return { path, args };
}

export const aufReply = (value: unknown): Response => Response.json({ status: "success", value });

type AirtableShaped = { id: string; fields: { Name?: string; "First Name"?: string; "Last Name"?: string } };
/** One `commaIdentity:humans` page holding these Humans, written as the old Airtable fixtures were. */
export const humansPage = (records: AirtableShaped[], more = false): Response =>
  aufReply({
    page: records.map(({ id, fields }) => ({ id, name: fields.Name, firstName: fields["First Name"], lastName: fields["Last Name"] })),
    continueCursor: more ? "next" : "",
    isDone: !more,
  });

type Searchable = AirtableShaped & { fields: { "Primary Phone"?: string; "Primary Email"?: string } };
/** The reply to a `commaIdentity:humans` or `commaIdentity:searchHumans` call over these Humans. */
export const humansReply = (path: string, records: Searchable[], more = false): Response =>
  path === "commaIdentity:searchHumans"
    ? aufReply(records.map(({ id, fields }) => ({
      id, name: fields.Name ?? "", firstName: fields["First Name"], lastName: fields["Last Name"],
      primaryPhone: fields["Primary Phone"], primaryEmail: fields["Primary Email"],
    })))
    : humansPage(records, more);
