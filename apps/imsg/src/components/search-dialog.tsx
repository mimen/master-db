import { useEffect, useState } from "react";
import type { Contact, Message } from "../../shared/types";
import { api } from "@/lib/api";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ContactAvatar } from "@/components/contact-avatar";
import { formatListTimestamp } from "@/lib/format";
import { toast } from "sonner";

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (chatGuid: string, target?: { guid: string; dateCreated: number }) => void;
}

export function SearchDialog({ open, onOpenChange, onPick }: SearchDialogProps) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setMessages([]);
      setContacts([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMessages([]);
      setContacts([]);
      return;
    }
    const handle = setTimeout(() => {
      setSearching(true);
      Promise.all([
        api.search(query.trim()).catch(() => []),
        api.contacts(query.trim()).catch(() => []),
      ])
        .then(([messageResults, contactResults]) => {
          setMessages(messageResults);
          setContacts(contactResults.slice(0, 6));
        })
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [query]);

  const openContact = (contact: Contact) => {
    onOpenChange(false);
    api
      .findChat(contact.address)
      .then(({ chatGuid }) => onPick(chatGuid))
      .catch(() => toast.info(`No conversation with ${contact.name} yet — start one from New message.`));
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search contacts and message history">
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search contacts and messages…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{searching ? "Searching…" : "No results"}</CommandEmpty>
          {contacts.length > 0 && (
            <CommandGroup heading="Contacts">
              {contacts.map((contact) => (
                <CommandItem
                  key={`c-${contact.name}-${contact.address}`}
                  value={`c-${contact.address}`}
                  onSelect={() => openContact(contact)}
                  className="gap-2.5"
                >
                  <ContactAvatar
                    address={contact.address}
                    name={contact.name}
                    className="size-7"
                    fallbackClassName="text-[10px]"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{contact.name}</span>
                    <span className="text-muted-foreground truncate text-xs">{contact.address}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {messages.length > 0 && (
            <CommandGroup heading="Messages">
              {messages.map((message) => (
                <CommandItem
                  key={message.guid}
                  value={message.guid}
                  onSelect={() => {
                    if (message.chatGuid) {
                      onPick(message.chatGuid, {
                        guid: message.guid,
                        dateCreated: message.dateCreated,
                      });
                      onOpenChange(false);
                    }
                  }}
                  className="flex flex-col items-start gap-0.5"
                >
                  <div className="flex w-full items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">
                      {message.isFromMe
                        ? "You"
                        : (message.sender?.name ?? message.sender?.address ?? "?")}
                    </span>
                    <span className="text-muted-foreground text-[10px]">
                      {formatListTimestamp(message.dateCreated)}
                    </span>
                  </div>
                  <span className="text-muted-foreground line-clamp-2 text-xs">{message.text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
