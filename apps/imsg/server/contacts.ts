import type { BBContact } from "./bb-types";
import type { BlueBubbles } from "./bluebubbles";
import { phoneMatchKey } from "../shared/address";
import type { Contact } from "../shared/types";

const REFRESH_MS = 10 * 60 * 1000;

function contactName(c: BBContact): string | null {
  const assembled = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return c.displayName?.trim() || c.nickname?.trim() || assembled || null;
}

export class ContactBook {
  private byExact = new Map<string, string>();
  private byDigitSuffix = new Map<string, string>();
  private avatarByExact = new Map<string, string>();
  private avatarByDigitSuffix = new Map<string, string>();
  private all: Contact[] = [];
  private lastRefresh = 0;
  private loaded = false;
  private availabilityListeners = new Set<(available: boolean) => void>();

  constructor(private client: BlueBubbles) {}

  /** Whether the latest contact classification attempt succeeded. */
  get available(): boolean {
    return this.loaded;
  }

  onAvailabilityChange(listener: (available: boolean) => void): () => void {
    this.availabilityListeners.add(listener);
    return () => this.availabilityListeners.delete(listener);
  }

  private setAvailable(available: boolean): void {
    if (available === this.loaded) return;
    this.loaded = available;
    for (const listener of this.availabilityListeners) listener(available);
  }

  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.lastRefresh < REFRESH_MS) return;
    let result: Awaited<ReturnType<BlueBubbles["contacts"]>>;
    try {
      result = await this.client.contacts();
    } catch {
      this.setAvailable(false);
      this.lastRefresh = 0;
      return;
    }
    if (!result.ok) {
      this.setAvailable(false);
      this.lastRefresh = 0;
      return;
    }
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
        const key = phoneMatchKey(phone.address);
        if (key) this.byDigitSuffix.set(key, name);
        this.byExact.set(phone.address, name);
        if (avatar) {
          this.avatarByExact.set(phone.address, avatar);
          if (key) this.avatarByDigitSuffix.set(key, avatar);
        }
        flat.push({ address: phone.address, name });
      }
    }
    this.all = flat;
    this.setAvailable(true);
  }

  /** Base64 image bytes for the contact photo, if any. */
  avatar(address: string): string | null {
    const exact =
      this.avatarByExact.get(address) ?? this.avatarByExact.get(address.toLowerCase());
    if (exact) return exact;
    const key = phoneMatchKey(address);
    return key ? (this.avatarByDigitSuffix.get(key) ?? null) : null;
  }

  lookup(address: string): string | null {
    const exact = this.byExact.get(address) ?? this.byExact.get(address.toLowerCase());
    if (exact) return exact;
    const key = phoneMatchKey(address);
    if (key) {
      const suffix = this.byDigitSuffix.get(key);
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
