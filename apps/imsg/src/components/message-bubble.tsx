import { useState } from "react";
import type { Message } from "../../shared/types";
import { api, attachmentUrl } from "@/lib/api";
import { formatBubbleTime, initials } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { LinkPreviewCard, firstUrl } from "@/components/link-preview-card";
import { cn } from "@/lib/utils";
import { CheckCheck, Reply, RotateCcw, SmilePlus } from "lucide-react";
import { toast } from "sonner";

const TAPBACKS: Array<{ type: string; emoji: string }> = [
  { type: "love", emoji: "❤️" },
  { type: "like", emoji: "👍" },
  { type: "dislike", emoji: "👎" },
  { type: "laugh", emoji: "😂" },
  { type: "emphasize", emoji: "‼️" },
  { type: "question", emoji: "❓" },
];

const TAPBACK_EMOJI = new Map(TAPBACKS.map((t) => [t.type, t.emoji]));

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const mine = message.isFromMe;
  const senderName = message.sender?.name ?? message.sender?.address ?? "";
  const url = message.text ? firstUrl(message.text) : null;

  const react = (type: string) => {
    setPickerOpen(false);
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
          <div className="text-muted-foreground border-border mb-0.5 max-w-full truncate rounded-lg border-l-2 bg-transparent px-2 py-0.5 text-[11px] italic">
            {message.replyToPreview || "Original message"}
          </div>
        )}

        <div className="relative">
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

      <div
        className={cn(
          "flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity group-hover/msg:opacity-100",
          mine && "order-first",
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={!privateApi}
              title={privateApi ? "React" : "Needs BlueBubbles private API"}
            >
              <SmilePlus className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" className="flex w-auto gap-1 p-1.5">
            {TAPBACKS.map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => react(t.type)}
                className={cn(
                  "hover:bg-accent rounded-full p-1 text-lg transition-transform hover:scale-110",
                  message.reactions.some((r) => r.isFromMe && r.type === t.type) && "bg-accent",
                )}
              >
                {t.emoji}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={!privateApi}
          title={privateApi ? "Reply" : "Needs BlueBubbles private API"}
          onClick={() => onReply(message)}
        >
          <Reply className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
