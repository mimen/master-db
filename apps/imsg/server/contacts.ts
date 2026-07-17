import type { BBContact } from "./bb-types";
import type { BlueBubblesClient } from "./bluebubbles";
import type { Contact } from "../shared/types";

const REFRESH_MS = 10 * 60 * 1000;

function contactName(c: BBContact): string | null {
  const assembled = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return c.displayName?.trim() || c.nickname?.trim() || assembled || null;
}

function digits(address: string): string {
  return address.replace(/\D/g, "");
}

export class ContactBook {
  private byExact = new Map<string, string>();
  private byDigitSuffix = new Map<string, string>();
  private all: Contact[] = [];
  private lastRefresh = 0;

  constructor(private client: BlueBubblesClient) {}

  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefresh < REFRESH_MS) return;
    const result = await this.client.contacts();
    if (!result.ok) return;
    this.lastRefresh = Date.now();
    this.byExact.clear();
    this.byDigitSuffix.clear();
    const flat: Contact[] = [];
    for (const contact of result.value) {
      const name = contactName(contact);
      if (!name) continue;
      for (const email of contact.emails ?? []) {
        if (!email.address) continue;
        this.byExact.set(email.address.toLowerCase(), name);
        flat.push({ address: email.address, name });
      }
      for (const phone of contact.phoneNumbers ?? []) {
        if (!phone.address) continue;
        const d = digits(phone.address);
        if (d.length >= 7) this.byDigitSuffix.set(d.slice(-10), name);
        this.byExact.set(phone.address, name);
        flat.push({ address: phone.address, name });
      }
    }
    this.all = flat;
  }

  lookup(address: string): string | null {
    const exact = this.byExact.get(address) ?? this.byExact.get(address.toLowerCase());
    if (exact) return exact;
    const d = digits(address);
    if (d.length >= 7) {
      const suffix = this.byDigitSuffix.get(d.slice(-10));
      if (suffix) return suffix;
    }
    return null;
  }

  search(q: string, limit = 20): Contact[] {
    const needle = q.toLowerCase();
    const seen = new Set<string>();
    const results: Contact[] = [];
    for (const contact of this.all) {
      if (results.length >= limit) break;
      if (
        contact.name.toLowerCase().includes(needle) ||
        contact.address.toLowerCase().includes(needle)
      ) {
        const key = `${contact.name}|${contact.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(contact);
      }
    }
    return results;
  }
}
