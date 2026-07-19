import type { BBContact } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
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
  private avatarByExact = new Map<string, string>();
  private avatarByDigitSuffix = new Map<string, string>();
  private all: Contact[] = [];
  private lastRefresh = 0;

  constructor(private client: BlueBubbles) {}

  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefresh < REFRESH_MS) return;
    const result = await this.client.contacts();
    if (!result.ok) return;
    this.lastRefresh = Date.now();
    this.byExact.clear();
    this.byDigitSuffix.clear();
    this.avatarByExact.clear();
    this.avatarByDigitSuffix.clear();
    const flat: Contact[] = [];
    for (const contact of result.value) {
      const name = contactName(contact);
      if (!name) continue;
      const avatar = contact.avatar?.trim() || null;
      for (const email of contact.emails ?? []) {
        if (!email.address) continue;
        this.byExact.set(email.address.toLowerCase(), name);
        if (avatar) this.avatarByExact.set(email.address.toLowerCase(), avatar);
        flat.push({ address: email.address, name });
      }
      for (const phone of contact.phoneNumbers ?? []) {
        if (!phone.address) continue;
        const d = digits(phone.address);
        if (d.length >= 7) this.byDigitSuffix.set(d.slice(-10), name);
        this.byExact.set(phone.address, name);
        if (avatar) {
          this.avatarByExact.set(phone.address, avatar);
          if (d.length >= 7) this.avatarByDigitSuffix.set(d.slice(-10), avatar);
        }
        flat.push({ address: phone.address, name });
      }
    }
    this.all = flat;
  }

  /** Base64 image bytes for the contact photo, if any. */
  avatar(address: string): string | null {
    const exact =
      this.avatarByExact.get(address) ?? this.avatarByExact.get(address.toLowerCase());
    if (exact) return exact;
    const d = digits(address);
    if (d.length >= 7) return this.avatarByDigitSuffix.get(d.slice(-10)) ?? null;
    return null;
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
