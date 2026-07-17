import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSummary, Message, ServerEvent, StateFilter, TypeFilter } from "../shared/types";
import { ChatList } from "@/components/chat-list";
import { FilterBar } from "@/components/filter-bar";
import { NewChatDialog } from "@/components/new-chat-dialog";
import { SearchDialog } from "@/components/search-dialog";
import { Thread } from "@/components/thread";
import { Toaster } from "@/components/ui/sonner";
import { useChats } from "@/hooks/use-chats";
import { usePrivateApi } from "@/hooks/use-health";
import type { JumpTarget } from "@/hooks/use-messages";
import { useServerEvents } from "@/hooks/use-server-events";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { MessageSquare } from "lucide-react";

export default function App() {
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [selected, setSelected] = useState<ChatSummary | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const privateApi = usePrivateApi();
  const { chats, counts, loading, refresh } = useChats(stateFilter, typeFilter);
  const threadUpsert = useRef<((message: Message) => void) | null>(null);
  const selectedGuidRef = useRef<string | null>(null);
  selectedGuidRef.current = selected?.guid ?? null;

  // Keep the selected chat object fresh as list data changes.
  useEffect(() => {
    if (!selected) return;
    const updated = chats.find((chat) => chat.guid === selected.guid);
    if (updated && updated !== selected) setSelected(updated);
  }, [chats, selected]);

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      if (event.kind === "new-message" || event.kind === "updated-message") {
        if (event.chatGuid === selectedGuidRef.current) {
          threadUpsert.current?.(event.message);
          // Viewing the chat = reading it; keep iMessage read state in sync.
          if (event.kind === "new-message" && !event.message.isFromMe) {
            void api.markRead(event.chatGuid);
          }
        }
        refresh();
      } else if (event.kind === "chats-changed") {
        refresh();
      }
    },
    [refresh],
  );
  useServerEvents(handleEvent);

  const openChatByGuid = useCallback(
    (chatGuid: string, target?: JumpTarget) => {
      setJumpTarget(target ?? null);
      const existing = chats.find((chat) => chat.guid === chatGuid);
      if (existing) {
        setSelected(existing);
        return;
      }
      // Chat not in the current filtered list — reset filters and select a stub.
      setStateFilter("all");
      setTypeFilter("all");
      setSelected({
        guid: chatGuid,
        displayName: chatGuid.split(";").pop() ?? chatGuid,
        isGroup: chatGuid.includes(";+;"),
        participants: [],
        lastMessage: null,
        unreadCount: 0,
        flags: {
          archived: false,
          unresponded: false,
          waiting: false,
          unread: false,
          mutedUnresponded: false,
        },
      });
      refresh();
    },
    [chats, refresh],
  );

  const registerUpsert = useCallback((fn: (message: Message) => void) => {
    threadUpsert.current = fn;
  }, []);

  return (
    <div className="bg-background flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "flex h-full w-full flex-col border-r md:w-90 md:shrink-0",
          selected && "max-md:hidden",
        )}
      >
        <FilterBar
          state={stateFilter}
          type={typeFilter}
          counts={counts}
          onStateChange={setStateFilter}
          onTypeChange={setTypeFilter}
          onNewChat={() => setNewChatOpen(true)}
          onSearch={() => setSearchOpen(true)}
        />
        <div className="flex-1 overflow-y-auto">
          <ChatList
            chats={chats}
            loading={loading}
            selectedGuid={selected?.guid ?? null}
            stateFilter={stateFilter}
            onSelect={(chat) => {
              setJumpTarget(null);
              setSelected(chat);
            }}
            onChanged={refresh}
          />
        </div>
      </aside>

      <main className={cn("h-full min-w-0 flex-1", !selected && "max-md:hidden")}>
        {selected ? (
          <Thread
            chat={selected}
            privateApi={privateApi}
            jumpTarget={jumpTarget}
            onBack={() => setSelected(null)}
            onChanged={refresh}
            registerUpsert={registerUpsert}
          />
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
            <MessageSquare className="size-10 opacity-40" />
            <span className="text-sm">Select a conversation</span>
          </div>
        )}
      </main>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onCreated={(chatGuid) => openChatByGuid(chatGuid)}
      />
      <SearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPick={(chatGuid, target) => openChatByGuid(chatGuid, target)}
      />
      <Toaster position="top-center" />
    </div>
  );
}
