import { BASE_URL } from "./config";
import type {
  AiStatus,
  ChatSummary,
  Contact,
  ContactSuggestion,
  GalleryItem,
  Message,
  ReplySuggestions,
  ScheduledMessage,
  SendTextRequest,
  ShadowBrief,
  ShadowMessage,
  SmartCloser,
  StateCounts,
  SuggestionFeedbackRequest,
  SuggestionModel,
  StateFilter,
  TranscriptState,
  TriageProgressStats,
  TypeFilter,
} from "@shared/types";

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
    body: SendTextRequest,
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
  dismiss(
    chatGuid: string,
    kind: "unresponded" | "waiting",
    expectedLatestMessageGuid?: string,
  ): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ kind, expectedLatestMessageGuid }),
    });
  },
  undismiss(chatGuid: string, kind: "unresponded" | "waiting"): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/undismiss`, {
      method: "POST",
      body: JSON.stringify({ kind }),
    });
  },
  setChatLater(chatGuid: string, until: number | null): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/later`, {
      method: "POST",
      body: JSON.stringify({ until }),
    });
  },
  getTriageStats(): Promise<TriageProgressStats> {
    return request("/api/triage/stats");
  },
  getSmartCloser(chatGuid: string): Promise<SmartCloser> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/smart-closer`);
  },
  getShadowBrief(chatGuid: string, regenerate = false): Promise<ShadowBrief> {
    const query = regenerate ? "?regenerate=1" : "";
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/shadow-brief${query}`);
  },
  setPinned(chatGuid: string, pinned: boolean): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/pin`, {
      method: "POST",
      body: JSON.stringify({ pinned }),
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
    body: { chatGuid: string; reaction: string; remove?: boolean; partIndex?: number; suggested?: boolean },
  ): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/react`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  unsend(messageGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/unsend`, { method: "POST" });
  },
  deleteMessage(messageGuid: string, chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/messages/${encodeURIComponent(messageGuid)}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatGuid }),
    });
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
  sendContactCard(chatGuid: string, contact: Contact, caption?: string): Promise<Message> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: contact.name, address: contact.address, caption }),
    });
  },
  findChat(address: string): Promise<{ chatGuid: string }> {
    return request(`/api/chats/find?address=${encodeURIComponent(address)}`);
  },
  newChat(body: { addresses: string[]; text: string }): Promise<{ chatGuid: string }> {
    return request("/api/chats/new", { method: "POST", body: JSON.stringify(body) });
  },
  search(q: string, opts: { chat?: string; from?: "me" | "them" } = {}): Promise<Message[]> {
    const params = new URLSearchParams({ q });
    if (opts.chat) params.set("chat", opts.chat);
    if (opts.from) params.set("from", opts.from);
    return request(`/api/search?${params.toString()}`);
  },
  gallery(chatGuid: string): Promise<GalleryItem[]> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/gallery`);
  },
  chatInfo(chatGuid: string): Promise<{
    guid: string;
    displayName: string | null;
    isGroup: boolean;
    participants: Contact[];
  }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/info`);
  },
  renameGroup(chatGuid: string, name: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/rename`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  participant(chatGuid: string, address: string, action: "add" | "remove"): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/participant`, {
      method: "POST",
      body: JSON.stringify({ address, action }),
    });
  },
  leaveGroup(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/leave`, { method: "POST" });
  },
  deleteChat(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/delete`, { method: "POST" });
  },
  listScheduled(): Promise<ScheduledMessage[]> {
    return request("/api/scheduled");
  },
  schedule(chatGuid: string, text: string, sendAt: number): Promise<ScheduledMessage> {
    return request("/api/scheduled", {
      method: "POST",
      body: JSON.stringify({ chatGuid, text, sendAt }),
    });
  },
  updateScheduled(id: number, chatGuid: string, text: string, sendAt: number): Promise<ScheduledMessage> {
    return request(`/api/scheduled/${id}`, {
      method: "PUT",
      body: JSON.stringify({ chatGuid, text, sendAt }),
    });
  },
  cancelScheduled(id: number): Promise<{ ok: boolean }> {
    return request(`/api/scheduled/${id}`, { method: "DELETE" });
  },
  sendScheduledNow(id: number): Promise<{ ok: true }> {
    return request(`/api/scheduled/${id}/send-now`, { method: "POST" });
  },
  transcriptState(attachmentGuid: string): Promise<TranscriptState> {
    return request(`/api/attachments/${encodeURIComponent(attachmentGuid)}/transcript`);
  },
  transcribe(attachmentGuid: string): Promise<TranscriptState> {
    return request(`/api/attachments/${encodeURIComponent(attachmentGuid)}/transcript`, { method: "POST" });
  },
  createFaceTimeLink(chatGuid: string): Promise<{ message: Message }> {
    return request(`/api/chats/${encodeURIComponent(chatGuid)}/facetime-link`, { method: "POST" });
  },
  health(): Promise<{ ok: boolean; privateApi: boolean }> {
    return request("/api/health");
  },
  /**
   * Fire-and-forget: tells the server to refresh its Identity Mirror (the
   * Convex name directory) right away, so an in-app "Add Contact" / rename
   * shows up in the inbox immediately instead of waiting for the mirror's
   * own 5-minute tick. 204 response — bypasses `request()`'s JSON parse.
   */
  refreshIdentity(): Promise<void> {
    return fetch(`${BASE_URL}/api/identity/refresh`, { method: "POST" }).then(() => undefined);
  },

  // ------------------------------------------------------------------- ai
  aiStatus(): Promise<AiStatus> {
    return request("/api/ai/status");
  },
  aiGroupNames(chatGuid: string): Promise<{ names: string[] }> {
    return request(`/api/ai/group-name/${encodeURIComponent(chatGuid)}`, { method: "POST" });
  },
  aiSuggestions(chatGuid: string, model: SuggestionModel, refresh = false): Promise<ReplySuggestions> {
    const params = new URLSearchParams({ model });
    if (refresh) params.set("refresh", "1");
    return request(`/api/ai/suggestions/${encodeURIComponent(chatGuid)}?${params.toString()}`);
  },
  recordSuggestionFeedback(chatGuid: string, body: SuggestionFeedbackRequest): Promise<{ ok: boolean }> {
    return request(`/api/ai/suggestions/${encodeURIComponent(chatGuid)}/feedback`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  clearSuggestionLearning(): Promise<{ ok: boolean }> {
    return request("/api/ai/suggestions/learning", { method: "DELETE" });
  },
  aiIdentify(chatGuid: string): Promise<ContactSuggestion> {
    return request(`/api/ai/identify/${encodeURIComponent(chatGuid)}`);
  },
  aiShadowHistory(chatGuid: string): Promise<{ messages: ShadowMessage[]; pending: boolean }> {
    return request(`/api/ai/shadow/${encodeURIComponent(chatGuid)}`);
  },
  aiShadowSend(chatGuid: string, text: string): Promise<{ ok: boolean; pending: boolean }> {
    return request(`/api/ai/shadow/${encodeURIComponent(chatGuid)}`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },
  aiShadowClear(chatGuid: string): Promise<{ ok: boolean }> {
    return request(`/api/ai/shadow/${encodeURIComponent(chatGuid)}`, { method: "DELETE" });
  },
};

export function avatarUrl(address: string): string {
  return `${BASE_URL}/api/avatars/${encodeURIComponent(address)}?v=3`;
}

export function groupPhotoUrl(chatGuid: string): string {
  return `${BASE_URL}/api/chats/${encodeURIComponent(chatGuid)}/photo?v=2`;
}

export function attachmentUrl(guid: string): string {
  return `${BASE_URL}/api/attachments/${encodeURIComponent(guid)}`;
}
