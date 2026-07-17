import type {
  ChatSummary,
  Contact,
  LinkPreviewData,
  Message,
  NewChatRequest,
  ReactRequest,
  SendTextRequest,
  StateCounts,
  StateFilter,
  TypeFilter,
} from "../../shared/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  chats(state: StateFilter, type: TypeFilter): Promise<ChatSummary[]> {
    return request(`/api/chats?state=${state}&type=${type}`);
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
  linkPreview(url: string): Promise<LinkPreviewData | null> {
    return request(`/api/link-preview?url=${encodeURIComponent(url)}`);
  },
  sendText(chatGuid: string, body: SendTextRequest): Promise<Message> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/send`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  async sendAttachment(chatGuid: string, file: File): Promise<Message> {
    const form = new FormData();
    form.append("attachment", file, file.name);
    const res = await fetch(`/api/chats/${encodeURIComponent(chatGuid)}/attachment`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(`attachment upload failed: ${res.status}`);
    return (await res.json()) as Message;
  },
  markRead(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/read`, { method: "POST" });
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
  unsend(messageGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/unsend`, { method: "POST" });
  },
  edit(messageGuid: string, text: string): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/edit`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },
  react(messageGuid: string, body: ReactRequest): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/react`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  contacts(q: string): Promise<Contact[]> {
    return request(`/api/contacts?q=${encodeURIComponent(q)}`);
  },
  findChat(address: string): Promise<{ chatGuid: string }> {
    return request(`/api/chats/find?address=${encodeURIComponent(address)}`);
  },
  newChat(body: NewChatRequest): Promise<{ chatGuid: string }> {
    return request("/api/chats/new", { method: "POST", body: JSON.stringify(body) });
  },
  search(q: string): Promise<Message[]> {
    return request(`/api/search?q=${encodeURIComponent(q)}`);
  },
};

export function attachmentUrl(guid: string): string {
  return `/api/attachments/${encodeURIComponent(guid)}`;
}
