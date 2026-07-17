import { BASE_URL } from "./config";
import type {
  ChatSummary,
  Contact,
  Message,
  StateCounts,
  StateFilter,
  TypeFilter,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  chats(state: StateFilter, type: TypeFilter): Promise<ChatSummary[]> {
    return request(`/api/chats?state=${state}&type=${type}`);
  },
  /** Raw list including archived — for clients that filter locally. */
  allChats(): Promise<ChatSummary[]> {
    return request(`/api/chats?state=any`);
  },
  counts(type: TypeFilter): Promise<StateCounts> {
    return request(`/api/counts?type=${type}`);
  },
  messages(
    chatGuid: string,
    window?: { before?: number; after?: number; around?: number },
  ): Promise<Message[]> {
    const params = new URLSearchParams();
    if (window?.before) params.set("before", String(window.before));
    if (window?.after) params.set("after", String(window.after));
    if (window?.around) params.set("around", String(window.around));
    const qs = params.size > 0 ? `?${params.toString()}` : "";
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/messages${qs}`);
  },
  sendText(
    chatGuid: string,
    body: { text: string; replyToGuid?: string },
  ): Promise<Message> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/send`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  markRead(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/read`, { method: "POST" });
  },
  markUnread(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/unread`, { method: "POST" });
  },
  setArchived(chatGuid: string, archived: boolean): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/archive`, {
      method: "POST",
      body: JSON.stringify({ archived }),
    });
  },
  dismiss(chatGuid: string, kind: "unresponded" | "waiting"): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
  },
  setMuted(chatGuid: string, muted: boolean): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/mute`, {
      method: "POST",
      body: JSON.stringify({ muted }),
    });
  },
  react(
    messageGuid: string,
    body: { chatGuid: string; reaction: string; remove?: boolean },
  ): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/react`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  unsend(messageGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/unsend`, { method: "POST" });
  },
  edit(messageGuid: string, text: string): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/edit`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },
  contacts(q: string): Promise<Contact[]> {
    return request(`/api/contacts?q=${encodeURIComponent(q)}`);
  },
  findChat(address: string): Promise<{ chatGuid: string }> {
    return request(`/api/chats/find?address=${encodeURIComponent(address)}`);
  },
  newChat(body: { addresses: string[]; text: string }): Promise<{ chatGuid: string }> {
    return request("/api/chats/new", { method: "POST", body: JSON.stringify(body) });
  },
  search(q: string): Promise<Message[]> {
    return request(`/api/search?q=${encodeURIComponent(q)}`);
  },
  health(): Promise<{ ok: boolean; privateApi: boolean }> {
    return request("/api/health");
  },
};

export function avatarUrl(address: string): string {
  return `${BASE_URL}/api/avatars/${encodeURIComponent(address)}?v=2`;
}

export function groupPhotoUrl(chatGuid: string): string {
  return `${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/photo?v=2`;
}

export function attachmentUrl(guid: string): string {
  return `${BASE_URL}/api/attachments/${encodeURIComponent(guid)}`;
}
