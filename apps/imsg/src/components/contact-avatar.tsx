import type { ChatSummary } from "../../shared/types";
import { initials } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

interface ContactAvatarProps {
  /** Handle address for DM/person avatars (contact photo lookup). */
  address?: string | null;
  /** Chat for chat-level avatars: group photo for groups, first participant otherwise. */
  chat?: ChatSummary;
  name: string;
  className?: string;
  fallbackClassName?: string;
}

export function ContactAvatar({
  address,
  chat,
  name,
  className,
  fallbackClassName,
}: ContactAvatarProps) {
  const isGroup = chat?.isGroup ?? false;
  const src = isGroup
    ? `/api/chats/${encodeURIComponent(chat?.guid ?? "")}/photo`
    : address || chat?.participants[0]?.address
      ? `/api/avatars/${encodeURIComponent(address ?? chat?.participants[0]?.address ?? "")}`
      : undefined;

  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback className={cn("text-sm", fallbackClassName)}>
        {isGroup ? <Users className="size-[45%]" /> : initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
