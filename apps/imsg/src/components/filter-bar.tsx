import type { StateCounts, StateFilter, TypeFilter } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, Search } from "lucide-react";

const STATES: Array<{ value: StateFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "unresponded", label: "Unresponded" },
  { value: "waiting", label: "Waiting" },
  { value: "archived", label: "Archived" },
];

const TYPES: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "Everyone" },
  { value: "dm", label: "DMs" },
  { value: "group", label: "Groups" },
];

interface SectionPillProps {
  label: string;
  count?: number;
  active: boolean;
  small?: boolean;
  onClick: () => void;
}

function SectionPill({ label, count, active, small, onClick }: SectionPillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full font-medium transition-colors",
        small ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 py-px text-[10px] leading-4 font-semibold tabular-nums",
            active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/80 text-muted-foreground",
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
    </button>
  );
}

interface FilterBarProps {
  state: StateFilter;
  type: TypeFilter;
  counts: StateCounts | null;
  onStateChange: (state: StateFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
  onNewChat: () => void;
  onSearch: () => void;
}

export function FilterBar({
  state,
  type,
  counts,
  onStateChange,
  onTypeChange,
  onNewChat,
  onSearch,
}: FilterBarProps) {
  return (
    <div className="flex flex-col gap-2 border-b px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Messages</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onSearch} aria-label="Search messages">
            <Search className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onNewChat} aria-label="New chat">
            <MessageSquarePlus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3">
        {STATES.map((item) => (
          <SectionPill
            key={item.value}
            label={item.label}
            count={counts?.[item.value]}
            active={state === item.value}
            onClick={() => onStateChange(item.value)}
          />
        ))}
      </div>
      <div className="flex gap-1.5">
        {TYPES.map((item) => (
          <SectionPill
            key={item.value}
            label={item.label}
            small
            active={type === item.value}
            onClick={() => onTypeChange(item.value)}
          />
        ))}
      </div>
    </div>
  );
}
