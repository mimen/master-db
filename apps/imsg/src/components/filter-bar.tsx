import type { StateCounts, StateFilter, TypeFilter } from "../../shared/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Check, ListFilter, MessageSquarePlus, Search } from "lucide-react";

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
  { value: "unknown", label: "Unknown" },
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
            "text-[10px] leading-4 font-semibold tabular-nums",
            active ? "text-primary-foreground/70" : "text-muted-foreground/70",
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
  const activeFilters = (state !== "all" ? 1 : 0) + (type !== "all" ? 1 : 0);

  return (
    <div className="flex flex-col gap-2 border-b px-4 py-2 md:px-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-[28px] font-bold md:text-lg md:font-semibold">Messages</h1>
        <div className="flex items-center gap-1 max-md:hidden">
          <Button variant="ghost" size="icon" onClick={onSearch} aria-label="Search messages">
            <Search className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onNewChat} aria-label="New chat">
            <MessageSquarePlus className="size-4" />
          </Button>
        </div>
        {/* Mobile: filters live in a menu, iMessage-style */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Filters"
              className="bg-muted relative flex size-10 items-center justify-center rounded-full md:hidden"
            >
              <ListFilter className="size-5" />
              {activeFilters > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex size-4.5 items-center justify-center rounded-full bg-[#0a84ff] text-[10px] font-semibold text-white">
                  {activeFilters}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {STATES.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onSelect={() => onStateChange(item.value)}
                className="justify-between"
              >
                <span className="flex items-center gap-2">
                  <Check className={cn("size-4", state === item.value ? "" : "invisible")} />
                  {item.label}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {counts?.[item.value] ?? ""}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {TYPES.map((item) => (
              <DropdownMenuItem key={item.value} onSelect={() => onTypeChange(item.value)}>
                <Check className={cn("size-4", type === item.value ? "" : "invisible")} />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap gap-1 max-md:hidden">
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
      <div className="flex flex-wrap gap-1 max-md:hidden">
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
