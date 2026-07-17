import { useEffect, useRef, useState } from "react";
import type { Message } from "../../shared/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { toast } from "sonner";

interface ComposerProps {
  chatGuid: string;
  replyTo: Message | null;
  /** When set, the composer edits this message instead of sending a new one. */
  editing: Message | null;
  onClearReply: () => void;
  onClearEditing: () => void;
  onEdited: (message: Message) => void;
  onSent: (message: Message) => void;
  /** Optimistic-send hooks: temp bubble immediately, settle/replace on response. */
  onOptimistic: (message: Message) => void;
  onSettled: (tempGuid: string, message: Message) => void;
}

function tempMessage(chatGuid: string, text: string, replyTo: Message | null): Message {
  return {
    guid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatGuid,
    text,
    dateCreated: Date.now(),
    dateRead: null,
    dateDelivered: null,
    isFromMe: true,
    sender: null,
    attachments: [],
    reactions: [],
    replyToGuid: replyTo?.guid ?? null,
    replyToPreview: replyTo ? replyTo.text.slice(0, 120) : null,
    replyToFromMe: replyTo?.isFromMe ?? null,
    isGroupEvent: false,
    error: 0,
    edited: false,
    retracted: false,
    pending: true,
  };
}

export function Composer({
  chatGuid,
  replyTo,
  editing,
  onClearReply,
  onClearEditing,
  onEdited,
  onSent,
  onOptimistic,
  onSettled,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) setText(editing.text);
  }, [editing]);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (editing) {
      setSending(true);
      try {
        await api.edit(editing.guid, trimmed);
        onEdited({ ...editing, text: trimmed, edited: true });
        setText("");
        onClearEditing();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Edit failed");
      } finally {
        setSending(false);
      }
      return;
    }
    const temp = tempMessage(chatGuid, trimmed, replyTo);
    const reply = replyTo;
    setText("");
    onClearReply();
    onOptimistic(temp);
    try {
      const message = await api.sendText(chatGuid, {
        text: trimmed,
        replyToGuid: reply?.guid,
      });
      onSettled(temp.guid, message);
    } catch {
      onSettled(temp.guid, { ...temp, pending: false, failed: true });
    }
  };

  const sendFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setSending(true);
    try {
      for (const file of Array.from(files)) {
        onSent(await api.sendAttachment(chatGuid, file));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Attachment failed");
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div
      className="border-t px-3 py-2"
      style={{ paddingBottom: "max(0.5rem, var(--kb-safe-bottom, env(safe-area-inset-bottom)))" }}
    >
      {replyTo && !editing && (
        <div className="bg-muted/60 mb-1.5 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs">
          <span className="truncate">
            Replying to: {replyTo.text.slice(0, 80) || "attachment"}
          </span>
          <button type="button" onClick={onClearReply} aria-label="Cancel reply">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {editing && (
        <div className="bg-muted/60 mb-1.5 flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs">
          <span className="truncate font-medium">Editing message</span>
          <button
            type="button"
            onClick={() => {
              setText("");
              onClearEditing();
            }}
            aria-label="Cancel edit"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => void sendFiles(e.target.files)}
        />
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={sending}
          onClick={() => fileRef.current?.click()}
          aria-label="Attach file"
        >
          <Paperclip className="size-4" />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={editing ? "Edit message" : "iMessage"}
          enterKeyHint="send"
          rows={1}
          className="max-h-36 min-h-9 flex-1 resize-none rounded-2xl py-1.5 text-[15px]"
        />
        <Button
          size="icon"
          className="shrink-0 rounded-full"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
          aria-label="Send"
        >
          <ArrowUp className="size-4" />
        </Button>
      </div>
    </div>
  );
}
