import { useEffect, useState } from "react";
import type { Contact } from "../../shared/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";
import { toast } from "sonner";

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (chatGuid: string) => void;
}

export function NewChatDialog({ open, onOpenChange, onCreated }: NewChatDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected([]);
      setText("");
      return;
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api.contacts(query.trim()).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const addManual = () => {
    const value = query.trim();
    if (!value) return;
    setSelected((current) => [...current, { address: value, name: value }]);
    setQuery("");
  };

  const create = async () => {
    if (selected.length === 0 || !text.trim()) return;
    setSending(true);
    try {
      const result = await api.newChat({
        addresses: selected.map((c) => c.address),
        text: text.trim(),
      });
      onOpenChange(false);
      onCreated(result.chatGuid);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not create chat");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((contact) => (
                <Badge key={contact.address} variant="secondary" className="gap-1">
                  {contact.name}
                  <button
                    type="button"
                    onClick={() =>
                      setSelected((current) => current.filter((c) => c.address !== contact.address))
                    }
                    aria-label={`Remove ${contact.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Input
            placeholder="Search contacts, or type a number/email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length === 0) addManual();
            }}
          />
          {results.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {results.map((contact) => (
                <button
                  key={`${contact.name}|${contact.address}`}
                  type="button"
                  className="hover:bg-accent flex w-full flex-col px-3 py-1.5 text-left"
                  onClick={() => {
                    setSelected((current) =>
                      current.some((c) => c.address === contact.address)
                        ? current
                        : [...current, contact],
                    );
                    setQuery("");
                  }}
                >
                  <span className="text-sm font-medium">{contact.name}</span>
                  <span className="text-muted-foreground text-xs">{contact.address}</span>
                </button>
              ))}
            </div>
          )}
          <Textarea
            placeholder="First message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
          <Button disabled={selected.length === 0 || !text.trim() || sending} onClick={() => void create()}>
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
