import { z } from "zod";

const humanId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
const contactSchema = z.object({
  humanId,
  channel: z.enum(["email", "sms"]),
  value: z.string().min(1),
  primary: z.boolean(),
}).strict();
export type CanonicalContact = z.infer<typeof contactSchema>;

/** A complete bounded read; failures never fall back to obsolete Airtable slots. */
export async function readCanonicalContacts(humanIds: string[]): Promise<CanonicalContact[]> {
  if (humanIds.length === 0) return [];
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
  const parsed = z.object({ contacts: z.array(contactSchema) }).strict().safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Invalid AUF canonical contact response");
  const requested = new Set(humanIds);
  if (parsed.data.contacts.some((row) => !requested.has(row.humanId)))
    throw new Error("AUF canonical contact response exceeded requested Humans");
  return parsed.data.contacts;
}

export function contactValues(contacts: CanonicalContact[], id: string, channel: "email" | "sms"): string[] {
  return [...new Set(contacts.filter((row) => row.humanId === id && row.channel === channel)
    .sort((a, b) => Number(b.primary) - Number(a.primary)).map((row) => row.value))];
}
