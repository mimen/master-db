import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatSummary, Message } from "../../shared/types";
import { useMessages, type JumpTarget } from "@/hooks/use-messages";
import { api } from "@/lib/api";
import { formatDayDivider, sameDay } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer } from "@/components/composer";
import { ContactAvatar } from "@/components/contact-avatar";
import { MessageBubble } from "@/components/message-bubble";
import { Archive, ArrowDown, ChevronLeft } from "lucide-react";

interface ThreadProps {
  chat: ChatSummary;
  privateApi: boolean;
  jumpTarget: JumpTarget | null;
  onBack: () => void;
  onChanged: () => void;
  registerUpsert: (fn: (message: Message) => void) => void;
}

export function Thread({
  chat,
  privateApi,
  jumpTarget,
  onBack,
  onChanged,
  registerUpsert,
}: ThreadProps) {
  const { messages, loading, hasMore, hasNewer, loadOlder, loadNewer, upsert, replaceTemp } =
    useMessages(chat.guid, jumpTarget);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [highlightGuid, setHighlightGuid] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const jumpedTo = useRef<string | null>(null);

  useEffect(() => {
    registerUpsert(upsert);
  }, [registerUpsert, upsert]);

  useEffect(() => {
    setReplyTo(null);
    stickToBottom.current = jumpTarget === null;
    jumpedTo.current = null;
    void api.markRead(chat.guid);
  }, [chat.guid, jumpTarget]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (jumpTarget && jumpedTo.current !== jumpTarget.guid && messages.length > 0) {
      const node = el.querySelector(`[data-guid="${CSS.escape(jumpTarget.guid)}"]`);
      if (node) {
        jumpedTo.current = jumpTarget.guid;
        node.scrollIntoView({ block: "center" });
        setHighlightGuid(jumpTarget.guid);
        const timer = setTimeout(() => setHighlightGuid(null), 2500);
        return () => clearTimeout(timer);
      }
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, jumpTarget]);

  // Keep pinned to bottom as images/media load and grow the content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    const mutation = new MutationObserver(() => {
      observer.disconnect();
      for (const child of Array.from(el.children)) observer.observe(child);
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    mutation.observe(el, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, [chat.guid]);

  const retry = (failed: Message) => {
    const revived: Message = { ...failed, pending: true, failed: false };
    replaceTemp(failed.guid, revived);
    api
      .sendText(chat.guid, { text: failed.text, replyToGuid: failed.replyToGuid ?? undefined })
      .then((message) => {
        replaceTemp(revived.guid, message);
        onChanged();
      })
      .catch(() => replaceTemp(revived.guid, { ...revived, pending: false, failed: true }));
  };

  const visible = messages.filter((m) => !m.isGroupEvent || m.text);
  const latestOutgoingGuid =
    [...visible].reverse().find((m) => m.isFromMe && !m.pending && !m.failed)?.guid ?? null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-2 md:px-4">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back">
          <ChevronLeft className="size-5" />
        </Button>
        <ContactAvatar chat={chat} name={chat.displayName} className="size-8" fallbackClassName="text-xs" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{chat.displayName}</div>
          {chat.isGroup && (
            <div className="text-muted-foreground truncate text-xs">
              {chat.participants.length} people
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={chat.flags.archived ? "Unarchive" : "Archive"}
          onClick={() => {
            void api.setArchived(chat.guid, !chat.flags.archived).then(onChanged);
          }}
        >
          <Archive className="size-4" />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 md:px-5"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current =
            !hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 80 && hasMore && !loading) {
            stickToBottom.current = false;
            loadOlder();
          }
          if (hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
            loadNewer();
          }
        }}
      >
        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton
                key={i}
                className={`h-9 w-2/5 rounded-2xl ${i % 2 ? "ml-auto" : ""}`}
              />
            ))}
          </div>
        )}
        {!loading && hasMore && (
          <div className="mb-2 flex justify-center">
            <Button variant="ghost" size="sm" className="text-xs" onClick={loadOlder}>
              Load earlier messages
            </Button>
          </div>
        )}
        {visible.map((message, index) => {
          const prev = visible[index - 1];
          const next = visible[index + 1];
          const newDay = !prev || !sameDay(prev.dateCreated, message.dateCreated);
          const sameSenderAsPrev =
            prev &&
            !newDay &&
            prev.isFromMe === message.isFromMe &&
            prev.sender?.address === message.sender?.address &&
            message.dateCreated - prev.dateCreated < 10 * 60 * 1000;
          const sameSenderAsNext =
            next &&
            sameDay(next.dateCreated, message.dateCreated) &&
            next.isFromMe === message.isFromMe &&
            next.sender?.address === message.sender?.address &&
            next.dateCreated - message.dateCreated < 10 * 60 * 1000;
          return (
            <div key={message.guid} data-guid={message.guid}>
              {newDay && (
                <div className="my-4 flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-muted-foreground shrink-0 text-[11px] font-medium">
                    {formatDayDivider(message.dateCreated)}
                  </span>
                  <Separator className="flex-1" />
                </div>
              )}
              {message.isGroupEvent ? (
                <div className="text-muted-foreground my-2 text-center text-[11px]">
                  {message.text}
                </div>
              ) : (
                <MessageBubble
                  message={message}
                  groupStart={!sameSenderAsPrev}
                  groupEnd={!sameSenderAsNext}
                  isGroupChat={chat.isGroup}
                  isLatestOutgoing={message.guid === latestOutgoingGuid}
                  privateApi={privateApi}
                  highlighted={highlightGuid === message.guid}
                  onReply={setReplyTo}
                  onRetry={retry}
                />
              )}
            </div>
          );
        })}
        {hasNewer && (
          <div className="mt-2 flex justify-center">
            <Button variant="ghost" size="sm" className="text-xs" onClick={loadNewer}>
              <ArrowDown className="size-3" /> Load newer messages
            </Button>
          </div>
        )}
      </div>

      <Composer
        chatGuid={chat.guid}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onOptimistic={(message) => {
          stickToBottom.current = !hasNewer;
          upsert(message);
        }}
        onSettled={(tempGuid, message) => {
          replaceTemp(tempGuid, message);
          onChanged();
        }}
        onSent={(message) => {
          stickToBottom.current = !hasNewer;
          upsert(message);
          onChanged();
        }}
      />
    </div>
  );
}
