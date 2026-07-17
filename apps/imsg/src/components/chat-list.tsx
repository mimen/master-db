import type { ChatSummary, StateFilter } from "../../shared/types";
import { api } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import { ContactAvatar } from "@/components/contact-avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  BellRing,
  CheckCheck,
  MailCheck,
  MailQuestion,
} from "lucide-react";

interface ChatListProps {
  chats: ChatSummary[];
  loading: boolean;
  selectedGuid: string | null;
  stateFilter: StateFilter;
  onSelect: (chat: ChatSummary) => void;
  onChanged: () => void;
}

function ChatRowMenu({ chat, onChanged }: { chat: ChatSummary; onChanged: () => void }) {
  const run = (action: Promise<unknown>) => {
    void action.then(onChanged).catch(onChanged);
  };
  return (
    <ContextMenuContent className="min-w-44">
      {chat.flags.unread && (
        <ContextMenuItem onSelect={() => run(api.markRead(chat.guid))}>
          <MailCheck /> Mark as read
        </ContextMenuItem>
      )}
      {chat.flags.unresponded && (
        <ContextMenuItem onSelect={() => run(api.dismiss(chat.guid, "unresponded"))}>
          <CheckCheck /> No reply needed
        </ContextMenuItem>
      )}
      {chat.flags.waiting && (
        <ContextMenuItem onSelect={() => run(api.dismiss(chat.guid, "waiting"))}>
          <MailQuestion /> Not waiting on this
        </ContextMenuItem>
      )}
      {(chat.flags.unread || chat.flags.unresponded || chat.flags.waiting) && (
        <ContextMenuSeparator />
      )}
      {chat.flags.archived ? (
        <ContextMenuItem onSelect={() => run(api.setArchived(chat.guid, false))}>
          <ArchiveRestore /> Unarchive
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => run(api.setArchived(chat.guid, true))}>
          <Archive /> Archive
        </ContextMenuItem>
      )}
      {chat.isGroup && (
        <ContextMenuItem
          onSelect={() => run(api.setMuted(chat.guid, !chat.flags.mutedUnresponded))}
        >
          {chat.flags.mutedUnresponded ? <BellRing /> : <BellOff />}
          {chat.flags.mutedUnresponded ? "Show in Unresponded" : "Hide from Unresponded"}
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}

export function ChatList({
  chats,
  loading,
  selectedGuid,
  stateFilter,
  onSelect,
  onChanged,
}: ChatListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
        {stateFilter === "all" ? "No conversations" : `Nothing ${stateFilter}`}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {chats.map((chat) => {
        const last = chat.lastMessage;
        const snippet = last
          ? `${last.isFromMe ? "You: " : chat.isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : ""}${
              last.text || (last.hasAttachments ? "Attachment" : "")
            }`
          : "";
        return (
          <ContextMenu key={chat.guid}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => onSelect(chat)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors md:py-2.5",
                  selectedGuid === chat.guid ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <div className="relative shrink-0">
                  <ContactAvatar
                    chat={chat}
                    name={chat.displayName}
                    className="size-12 md:size-11"
                  />
                  {chat.flags.unread && (
                    <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] font-semibold ring-2 ring-white dark:ring-neutral-900">
                      {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-[15px] md:text-sm",
                        chat.flags.unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {chat.displayName}
                    </span>
                    {last && (
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {formatListTimestamp(last.dateCreated)}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "line-clamp-1 text-[13px] md:text-xs",
                      chat.flags.unread ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {snippet}
                  </span>
                </div>
              </button>
            </ContextMenuTrigger>
            <ChatRowMenu chat={chat} onChanged={onChanged} />
          </ContextMenu>
        );
      })}
    </div>
  );
}
