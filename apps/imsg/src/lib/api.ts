import type {
  ChatSummary,
  Contact,
  Message,
  NewChatRequest,
  ReactRequest,
  SendTextRequest,
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
  messages(chatGuid: string, before?: number): Promise<Message[]> {
    const qs = before ? `?before=${before}` : "";
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/messages${qs}`);
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
  react(messageGuid: string, body: ReactRequest): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/react`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  contacts(q: string): Promise<Contact[]> {
    return request(`/api/contacts?q=${encodeURIComponent(q)}`);
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
