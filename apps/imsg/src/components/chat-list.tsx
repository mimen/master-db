import type { ChatSummary, StateFilter } from "../../shared/types";
import { api } from "@/lib/api";
import { formatListTimestamp, initials } from "@/lib/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Archive, ArchiveRestore, BellOff, CheckCheck, MoreHorizontal, Users } from "lucide-react";

interface ChatListProps {
  chats: ChatSummary[];
  loading: boolean;
  selectedGuid: string | null;
  stateFilter: StateFilter;
  onSelect: (chat: ChatSummary) => void;
  onChanged: () => void;
}

function ChatRowActions({ chat, onChanged }: { chat: ChatSummary; onChanged: () => void }) {
  const run = (action: Promise<unknown>) => {
    void action.then(onChanged).catch(onChanged);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100"
          onClick={(e) => e.stopPropagation()}
          aria-label="Chat actions"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {chat.flags.archived ? (
          <DropdownMenuItem onClick={() => run(api.setArchived(chat.guid, false))}>
            <ArchiveRestore className="size-4" /> Unarchive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => run(api.setArchived(chat.guid, true))}>
            <Archive className="size-4" /> Archive
          </DropdownMenuItem>
        )}
        {chat.flags.unresponded && (
          <DropdownMenuItem onClick={() => run(api.dismiss(chat.guid, "unresponded"))}>
            <CheckCheck className="size-4" /> No reply needed
          </DropdownMenuItem>
        )}
        {chat.flags.waiting && (
          <DropdownMenuItem onClick={() => run(api.dismiss(chat.guid, "waiting"))}>
            <CheckCheck className="size-4" /> Not waiting on this
          </DropdownMenuItem>
        )}
        {chat.isGroup && (
          <DropdownMenuItem
            onClick={() => run(api.setMuted(chat.guid, !chat.flags.mutedUnresponded))}
          >
            <BellOff className="size-4" />
            {chat.flags.mutedUnresponded ? "Show in Unresponded" : "Hide from Unresponded"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
          <button
            key={chat.guid}
            type="button"
            onClick={() => onSelect(chat)}
            className={cn(
              "group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
              selectedGuid === chat.guid ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <div className="relative shrink-0">
              <Avatar className="size-11">
                <AvatarFallback className="text-sm">
                  {chat.isGroup ? <Users className="size-5" /> : initials(chat.displayName)}
                </AvatarFallback>
              </Avatar>
              {chat.flags.unread && (
                <span className="bg-primary absolute -top-0.5 -right-0.5 size-3 rounded-full ring-2 ring-white dark:ring-neutral-900" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "truncate text-sm",
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
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "truncate text-xs",
                    chat.flags.unread ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {snippet}
                </span>
                <ChatRowActions chat={chat} onChanged={onChanged} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
