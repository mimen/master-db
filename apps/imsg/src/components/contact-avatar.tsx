import type { ChatSummary, Participant } from "../../shared/types";
import { initials } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";

interface ContactAvatarProps {
  /** Handle address for DM/person avatars (contact photo lookup). */
  address?: string | null;
  /** Chat for chat-level avatars: group photo/composite for groups. */
  chat?: ChatSummary;
  name: string;
  className?: string;
  fallbackClassName?: string;
}

function PersonAvatar({
  address,
  name,
  className,
  fallbackClassName,
}: {
  address: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={className}>
      {address && (
        <AvatarImage src={`/api/avatars/${encodeURIComponent(address)}?v=2`} alt={name} />
      )}
      <AvatarFallback className={cn("text-sm", fallbackClassName)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/** iMessage-style composite: two overlapping member photos. */
function GroupComposite({ participants }: { participants: Participant[] }) {
  // Prefer named participants — likelier to have contact photos.
  const sorted = [...participants].sort((a, b) => Number(b.name !== null) - Number(a.name !== null));
  const back = sorted[0];
  const front = sorted[1] ?? sorted[0];
  if (!back) {
    return (
      <div className="bg-muted flex size-full items-center justify-center rounded-full">
        <Users className="text-muted-foreground size-[45%]" />
      </div>
    );
  }
  return (
    <div className="relative size-full">
      <PersonAvatar
        address={back.address}
        name={back.name ?? back.address}
        className="absolute top-0 right-0 size-[68%]"
        fallbackClassName="text-[9px]"
      />
      <PersonAvatar
        address={front?.address ?? back.address}
        name={front?.name ?? front?.address ?? ""}
        className="ring-background absolute bottom-0 left-0 size-[58%] ring-2"
        fallbackClassName="text-[8px]"
      />
    </div>
  );
}

export function ContactAvatar({
  address,
  chat,
  name,
  className,
  fallbackClassName,
}: ContactAvatarProps) {
  const isGroup = chat?.isGroup ?? false;

  if (isGroup && chat) {
    return (
      <Avatar className={cn("overflow-visible", className)}>
        <AvatarImage
          src={`/api/chats/${encodeURIComponent(chat.guid)}/photo?v=2`}
          alt={name}
          className="rounded-full"
        />
        <AvatarFallback className="bg-transparent">
          <GroupComposite participants={chat.participants} />
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <PersonAvatar
      address={address ?? chat?.participants[0]?.address ?? null}
      name={name}
      className={className}
      fallbackClassName={fallbackClassName}
    />
  );
}
