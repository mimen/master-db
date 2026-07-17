import { useEffect, useState } from "react";
import type { Message } from "../../shared/types";
import { api } from "@/lib/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { formatListTimestamp } from "@/lib/format";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (chatGuid: string, target: { guid: string; dateCreated: number }) => void;
}

export function SearchDialog({ open, onOpenChange, onPick }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      api
        .search(query.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search messages" description="Search recent message history">
      <CommandInput
        placeholder="Search messages…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>{searching ? "Searching…" : "No results"}</CommandEmpty>
        {results.map((message) => (
          <CommandItem
            key={message.guid}
            value={`${message.text} ${message.guid}`}
            onSelect={() => {
              if (message.chatGuid) {
                onPick(message.chatGuid, { guid: message.guid, dateCreated: message.dateCreated });
                onOpenChange(false);
              }
            }}
            className="flex flex-col items-start gap-0.5"
          >
            <div className="flex w-full items-baseline justify-between gap-2">
              <span className="text-xs font-medium">
                {message.isFromMe ? "You" : (message.sender?.name ?? message.sender?.address ?? "?")}
              </span>
              <span className="text-muted-foreground text-[10px]">
                {formatListTimestamp(message.dateCreated)}
              </span>
            </div>
            <span className="text-muted-foreground line-clamp-2 text-xs">{message.text}</span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
