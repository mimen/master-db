import { motion, useMotionValue, useTransform } from "motion/react";
import type { ChatSummary, StateFilter } from "../../shared/types";
import { api } from "@/lib/api";
import { formatListTimestamp } from "@/lib/format";
import { ContactAvatar } from "@/components/contact-avatar";
import { longPress } from "@/hooks/use-long-press";
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

/** Interactive swipe: right reveals read/unread toggle, left reveals archive. */
function SwipeableRow({
  chat,
  onChanged,
  children,
}: {
  chat: ChatSummary;
  onChanged: () => void;
  children: React.ReactNode;
}) {
  const x = useMotionValue(0);
  const leftOpacity = useTransform(x, [0, 40, 90], [0, 0.4, 1]);
  const rightOpacity = useTransform(x, [-90, -40, 0], [1, 0.4, 0]);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const THRESHOLD = 80;

  return (
    <div className="relative overflow-hidden" style={{ touchAction: "pan-y" }}>
      {/* Action backdrops */}
      <motion.div
        style={{ opacity: leftOpacity }}
        className="absolute inset-y-0 left-0 flex w-28 items-center justify-start bg-[#0a84ff] pl-5 text-white"
      >
        {chat.flags.unread ? <MailCheck className="size-6" /> : <MailQuestion className="size-6" />}
      </motion.div>
      <motion.div
        style={{ opacity: rightOpacity }}
        className="absolute inset-y-0 right-0 flex w-28 items-center justify-end bg-amber-500 pr-5 text-white"
      >
        <Archive className="size-6" />
      </motion.div>
      <motion.div
        className="bg-background relative"
        style={{ x }}
        drag={isMobile ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.35, right: 0.35 }}
        dragSnapToOrigin
        dragTransition={{ bounceStiffness: 600, bounceDamping: 35 }}
        onDragEnd={(_, info) => {
          const dx = info.offset.x;
          const fast = Math.abs(info.velocity.x) > 500;
          if (dx > THRESHOLD || (fast && dx > 30)) {
            void (chat.flags.unread ? api.markRead(chat.guid) : api.markUnread(chat.guid))
              .then(onChanged)
              .catch(onChanged);
          } else if (dx < -THRESHOLD || (fast && dx < -30)) {
            void api.setArchived(chat.guid, !chat.flags.archived).then(onChanged).catch(onChanged);
          }
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function ChatRowMenu({ chat, onChanged }: { chat: ChatSummary; onChanged: () => void }) {
  const run = (action: Promise<unknown>) => {
    void action.then(onChanged).catch(onChanged);
  };
  return (
    <ContextMenuContent className="min-w-44">
      {chat.flags.unread ? (
        <ContextMenuItem onSelect={() => run(api.markRead(chat.guid))}>
          <MailCheck /> Mark as read
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={() => run(api.markUnread(chat.guid))}>
          <MailQuestion /> Mark as unread
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
      {chats.map((chat, index) => {
        const last = chat.lastMessage;
        const snippet = last
          ? `${last.isFromMe ? "You: " : chat.isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : ""}${
              last.text || (last.hasAttachments ? "Attachment" : "")
            }`
          : "";
        return (
          <div key={chat.guid}>
            {index > 0 && <div className="border-border/70 ml-[5.5rem] border-t md:ml-[4.5rem]" />}
            <SwipeableRow chat={chat} onChanged={onChanged}>
            <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                onClick={() => onSelect(chat)}
                {...longPress()}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-3.5 text-left transition-colors [-webkit-touch-callout:none] select-none md:select-auto md:py-2.5",
                  selectedGuid === chat.guid ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                {/* iMessage-style unread indicator */}
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    chat.flags.unread ? "bg-[#0a84ff]" : "bg-transparent",
                  )}
                  aria-hidden
                />
                <ContactAvatar
                  chat={chat}
                  name={chat.displayName}
                  className="size-13 shrink-0 md:size-11"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-[17px] md:text-sm",
                        chat.flags.unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {chat.displayName}
                    </span>
                    {last && (
                      <span className="text-muted-foreground shrink-0 text-[15px] md:text-xs">
                        {formatListTimestamp(last.dateCreated)}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "line-clamp-2 text-[15px] leading-snug md:line-clamp-1 md:text-xs",
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
            </SwipeableRow>
          </div>
        );
      })}
    </div>
  );
}
