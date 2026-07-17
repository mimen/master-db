import type { Message } from "../../shared/types";
import { api, attachmentUrl } from "@/lib/api";
import { formatBubbleTime, initials } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { LinkPreviewCard, firstUrl } from "@/components/link-preview-card";
import { cn } from "@/lib/utils";
import { CheckCheck, Copy, Reply, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const TAPBACKS: Array<{ type: string; emoji: string; label: string }> = [
  { type: "love", emoji: "❤️", label: "Love" },
  { type: "like", emoji: "👍", label: "Like" },
  { type: "dislike", emoji: "👎", label: "Dislike" },
  { type: "laugh", emoji: "😂", label: "Haha" },
  { type: "emphasize", emoji: "‼️", label: "Emphasize" },
  { type: "question", emoji: "❓", label: "Question" },
];

const TAPBACK_EMOJI = new Map(TAPBACKS.map((t) => [t.type, t.emoji]));

function TapbackGlyph({ type, emoji }: { type: string; emoji: string }) {
  if (type === "laugh") {
    return (
      <span className="flex flex-col items-center leading-none font-black tracking-tight text-sky-400">
        <span className="text-[9px]">HA</span>
        <span className="text-[9px]">HA</span>
      </span>
    );
  }
  return <span className="text-xl leading-none">{emoji}</span>;
}

interface MessageBubbleProps {
  message: Message;
  /** First / last message of a consecutive same-sender group. */
  groupStart: boolean;
  groupEnd: boolean;
  isGroupChat: boolean;
  isLatestOutgoing: boolean;
  privateApi: boolean;
  highlighted: boolean;
  onReply: (message: Message) => void;
  onRetry: (message: Message) => void;
}

function AttachmentView({ message }: { message: Message }) {
  return (
    <div className="flex flex-col gap-1.5">
      {message.attachments.map((att) => {
        const url = attachmentUrl(att.guid);
        if (att.mimeType?.startsWith("audio/") || /\.(caf|amr|m4a|mp3)$/i.test(att.filename ?? "")) {
          return <audio key={att.guid} src={url} controls preload="metadata" className="max-w-full" />;
        }
        if (att.mimeType?.startsWith("image/")) {
          return (
            <a key={att.guid} href={url} target="_blank" rel="noreferrer">
              <img
                src={url}
                alt={att.filename ?? "image"}
                loading="lazy"
                className="max-h-72 max-w-full rounded-xl object-cover"
              />
            </a>
          );
        }
        if (att.mimeType?.startsWith("video/")) {
          return (
            <video key={att.guid} src={url} controls className="max-h-72 max-w-full rounded-xl" />
          );
        }
        return (
          <a
            key={att.guid}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline underline-offset-2"
          >
            {att.filename ?? "Attachment"}
          </a>
        );
      })}
    </div>
  );
}

export function MessageBubble({
  message,
  groupStart,
  groupEnd,
  isGroupChat,
  isLatestOutgoing,
  privateApi,
  highlighted,
  onReply,
  onRetry,
}: MessageBubbleProps) {
  const mine = message.isFromMe;
  const senderName = message.sender?.name ?? message.sender?.address ?? "";
  const url = message.text ? firstUrl(message.text) : null;

  const react = (type: string) => {
    const mineAlready = message.reactions.some((r) => r.isFromMe && r.type === type);
    api
      .react(message.guid, { chatGuid: message.chatGuid, reaction: type, remove: mineAlready })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Reaction failed"));
  };

  return (
    <div
      className={cn(
        "group/msg flex w-full items-end gap-2",
        mine ? "justify-end" : "justify-start",
        groupEnd ? "mb-2" : "mb-0.5",
      )}
    >
      {!mine && (
        <div className="w-7 shrink-0">
          {groupEnd && (
            <Avatar className="size-7">
              {message.sender?.address && (
                <AvatarImage
                  src={`/api/avatars/${encodeURIComponent(message.sender.address)}`}
                  alt={senderName}
                />
              )}
              <AvatarFallback className="text-[10px]">{initials(senderName)}</AvatarFallback>
            </Avatar>
          )}
        </div>
      )}

      <div className={cn("flex max-w-[78%] flex-col md:max-w-[65%]", mine ? "items-end" : "items-start")}>
        {!mine && isGroupChat && groupStart && senderName && (
          <span className="text-muted-foreground mb-0.5 px-1 text-[11px]">{senderName}</span>
        )}
        {message.replyToPreview !== null && (
          <div className={cn("mb-0 flex w-full flex-col", mine ? "items-end" : "items-start")}>
            {/* Quoted original: outlined bubble in the original sender's tint */}
            <div
              className={cn(
                "max-w-full rounded-2xl border-[1.5px] bg-transparent px-3 py-1.5 text-[13px] leading-snug",
                message.replyToFromMe
                  ? "border-primary/50 text-primary/90"
                  : "border-muted-foreground/40 text-muted-foreground",
                "line-clamp-2",
              )}
            >
              {message.replyToPreview || "Original message"}
            </div>
            {/* Connector curve from quote down to the reply bubble */}
            <div
              className={cn(
                "h-3 w-5 border-[1.5px] border-t-0",
                mine
                  ? "mr-4 rounded-br-xl border-l-0 border-muted-foreground/40"
                  : "ml-4 rounded-bl-xl border-r-0 border-muted-foreground/40",
              )}
              aria-hidden
            />
          </div>
        )}

        <div className="relative">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  "rounded-2xl px-3 py-1.5 text-[15px] leading-snug break-words whitespace-pre-wrap transition-colors duration-700",
                  mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                  mine && !groupEnd && "rounded-br-md",
                  mine && groupEnd && "rounded-br-sm",
                  !mine && !groupEnd && "rounded-bl-md",
                  !mine && groupEnd && "rounded-bl-sm",
                  message.pending && "opacity-60",
                  message.failed && "bg-destructive/15 text-foreground",
                  highlighted && "ring-primary/60 ring-2",
                )}
              >
                {message.attachments.length > 0 && <AttachmentView message={message} />}
                {message.text}
                {url && <LinkPreviewCard url={url} mine={mine} />}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="min-w-44">
              {privateApi && (
                <>
                  <div className="flex gap-0.5 px-1 py-0.5">
                    {TAPBACKS.map((t) => {
                      const active = message.reactions.some(
                        (r) => r.isFromMe && r.type === t.type,
                      );
                      return (
                        <ContextMenuItem
                          key={t.type}
                          title={t.label}
                          onSelect={() => react(t.type)}
                          className={cn(
                            "flex size-8 items-center justify-center rounded-full p-0 transition-transform hover:scale-110",
                            active && "bg-sky-500 focus:bg-sky-500",
                          )}
                        >
                          <TapbackGlyph type={t.type} emoji={t.emoji} />
                        </ContextMenuItem>
                      );
                    })}
                  </div>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuItem
                onSelect={() =>
                  privateApi
                    ? onReply(message)
                    : toast.info("Threaded replies need the BlueBubbles Private API.")
                }
              >
                <Reply /> Reply
              </ContextMenuItem>
              {message.text && (
                <ContextMenuItem
                  onSelect={() => {
                    void navigator.clipboard.writeText(message.text);
                    toast.success("Copied");
                  }}
                >
                  <Copy /> Copy text
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>

          {message.reactions.length > 0 && (
            <div
              className={cn(
                "absolute -top-3 flex gap-0.5",
                mine ? "-left-2" : "-right-2",
              )}
            >
              {Object.entries(
                message.reactions.reduce<Record<string, number>>((acc, r) => {
                  acc[r.type] = (acc[r.type] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([type, count]) => (
                <span
                  key={type}
                  className="bg-background rounded-full border px-1.5 py-0.5 text-[11px] shadow-sm"
                >
                  {TAPBACK_EMOJI.get(type) ?? type}
                  {count > 1 ? ` ${count}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        {message.failed ? (
          <button
            type="button"
            onClick={() => onRetry(message)}
            className="text-destructive mt-0.5 flex items-center gap-1 px-1 text-[10px] font-medium"
          >
            <RotateCcw className="size-3" /> Failed — tap to retry
          </button>
        ) : message.pending ? (
          <span className="text-muted-foreground mt-0.5 px-1 text-[10px]">Sending…</span>
        ) : (
          groupEnd && (
            <span className="text-muted-foreground mt-0.5 flex items-center gap-1 px-1 text-[10px]">
              {formatBubbleTime(message.dateCreated)}
              {mine && isLatestOutgoing && (
                <span className="flex items-center gap-0.5">
                  <CheckCheck className="size-3" />
                  {message.dateRead ? "Read" : message.dateDelivered ? "Delivered" : "Sent"}
                </span>
              )}
            </span>
          )
        )}
      </div>

    </div>
  );
}
