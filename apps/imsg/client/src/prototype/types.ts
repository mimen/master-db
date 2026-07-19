// PROTOTYPE — throwaway types for comparing inbox design directions.
export type PrototypeAttention = "reply" | "waiting" | "clear";
export type PrototypeLens = "all" | "reply" | "unread" | "waiting" | "groups";

export interface PrototypeChat {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  preview: string;
  time: string;
  unreadCount: number;
  attention: PrototypeAttention;
  isGroup: boolean;
  participants: number;
  lastFromMe: boolean;
  pinned: boolean;
}

export interface PrototypeMessage {
  id: string;
  chatId: string;
  text: string;
  time: string;
  fromMe: boolean;
  sender?: string;
  reaction?: string;
}

export interface PrototypeDesignProps {
  chats: readonly PrototypeChat[];
  messages: readonly PrototypeMessage[];
  selectedChatId: string;
  onSelectChat: (chatId: string) => void;
}
