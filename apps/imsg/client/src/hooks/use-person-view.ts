import { useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { Linking } from "react-native";
import { matchesAnyAddress } from "@shared/address";
import type { ChatSummary } from "@shared/types";
import { getChats, subscribeChats } from "@/lib/chat-store";
import { type WhoIsResult, useWhoIs } from "@/lib/identity";
import { selectChat } from "@/lib/selection";

function useSharedChats(knownAddresses: string[]): ChatSummary[] {
  const [all, setAll] = useState<ChatSummary[]>(getChats() ?? []);
  useEffect(() => subscribeChats(setAll), []);
  if (knownAddresses.length === 0) return [];
  return all.filter((c) => c.participants.some((p) => matchesAnyAddress(p.address, knownAddresses)));
}

export interface PersonView {
  result: WhoIsResult | undefined;
  /** Every chat (1:1 + groups) this person is in, newest activity first. */
  sortedChats: ChatSummary[];
  lastContactedAt: number | undefined;
  canCall: boolean;
  handleMessage: () => void;
  handleCall: () => void;
  openChat: (chat: ChatSummary) => void;
}

/**
 * All the person-view's data plumbing: identity lookup, matching this
 * person's known handles against imsg's own cached chat list (via the
 * shared address matcher — see shared/address.ts), and the two actions
 * (Message, Call) that depend on that matching. Kept separate from
 * PersonContent so this logic is unit-testable without rendering anything.
 */
export function usePersonView(address: string, name?: string): PersonView {
  const result = useWhoIs(address);

  const phones = result?.found ? result.person.normalized_phones : [];
  const emails = result?.found ? result.person.normalized_emails : [];
  // Not memoized: `phones`/`emails` are already fresh arrays every render
  // (the `: []` fallback above), so a useMemo here would never actually
  // stabilize — the spread itself is cheap enough not to need it.
  const sharedChats = useSharedChats([...phones, ...emails]);
  const sortedChats = useMemo(
    () => [...sharedChats].sort((a, b) => (b.lastMessage?.dateCreated ?? 0) - (a.lastMessage?.dateCreated ?? 0)),
    [sharedChats],
  );
  const directChat = sortedChats.find((c) => !c.isGroup);
  const lastContactedAt = sortedChats[0]?.lastMessage?.dateCreated;
  const canCall = phones.length > 0;

  const openChat = (chat: ChatSummary) => {
    if (!selectChat({ guid: chat.guid, name: chat.displayName, isGroup: chat.isGroup })) {
      router.push({
        pathname: "/chat/[guid]",
        params: { guid: chat.guid, name: chat.displayName, isGroup: chat.isGroup ? "1" : "0" },
      });
      return;
    }
    router.push("/");
  };

  const handleMessage = () => {
    if (directChat) {
      openChat(directChat);
      return;
    }
    router.push({ pathname: "/new-chat", params: { address, name: name ?? "" } });
  };

  const handleCall = () => {
    if (phones[0]) Linking.openURL(`tel:${phones[0]}`);
  };

  return { result, sortedChats, lastContactedAt, canCall, handleMessage, handleCall, openChat };
}
