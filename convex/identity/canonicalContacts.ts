import { z } from "zod";

import { normalizeEmail, normalizePhone } from "./normalize";

const humanId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
const contactSchema = z.object({
  humanId,
  channel: z.enum(["email", "sms"]),
  value: z.string().min(1),
  primary: z.boolean(),
}).strict();
export type CanonicalContact = z.infer<typeof contactSchema>;

/** A complete bounded read; failures never fall back to obsolete Airtable slots. */
export type CanonicalSnapshot = { contacts: CanonicalContact[]; resolutions: { humanId: string; canonicalHumanId: string | null }[] };
export async function readCanonicalSnapshot(humanIds: string[]): Promise<CanonicalSnapshot> {
  if (humanIds.length === 0) return { contacts: [], resolutions: [] };
  z.array(humanId).max(100).parse(humanIds);
  const token = process.env.AUF_CANONICAL_CONTACT_READ_TOKEN;
  const endpoint = process.env.AUF_CANONICAL_CONTACT_READ_URL;
  if (!token || !endpoint) throw new Error("AUF canonical contact read is not configured");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.pathname !== "/canonical-contacts/read" || url.username || url.password)
    throw new Error("Invalid AUF canonical contact read URL");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ humanIds }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`AUF canonical contact read failed: ${response.status}`);
  const parsed = z.object({ contacts: z.array(contactSchema), resolutions: z.array(z.object({ humanId, canonicalHumanId: humanId.nullable() }).strict()) }).strict().safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Invalid AUF canonical contact response");
  const requested = new Set(humanIds);
  if (parsed.data.contacts.some((row) => !requested.has(row.humanId)))
    throw new Error("AUF canonical contact response exceeded requested Humans");
  const resolutions = parsed.data.resolutions;
  if (resolutions.length !== requested.size || new Set(resolutions.map((r) => r.humanId)).size !== requested.size ||
      resolutions.some((r) => !requested.has(r.humanId)) ||
      parsed.data.contacts.some((c) => !resolutions.find((r) => r.humanId === c.humanId)?.canonicalHumanId))
    throw new Error("Incomplete AUF Human resolutions");
  return parsed.data;
}

export function contactValues(contacts: CanonicalContact[], id: string, channel: "email" | "sms"): string[] {
  return [...new Set(contacts.filter((row) => row.humanId === id && row.channel === channel)
    .sort((a, b) => Number(b.primary) - Number(a.primary)).map((row) => row.value))];
}

export async function readCanonicalContacts(humanIds: string[]): Promise<CanonicalContact[]> {
  return (await readCanonicalSnapshot(humanIds)).contacts;
}

export function canonicalDisplay(primary: string | undefined, values: string[], channel: "email" | "sms"): string | undefined {
  const normalize = channel === "email" ? normalizeEmail : normalizePhone;
  return primary && normalize(primary) && values.some((value) => normalize(value) === normalize(primary)) ? primary : values[0];
}
