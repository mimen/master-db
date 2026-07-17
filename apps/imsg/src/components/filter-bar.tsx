import type { StateFilter, TypeFilter } from "../../shared/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquarePlus, Search } from "lucide-react";

const STATE_LABELS: Array<{ value: StateFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "unresponded", label: "Unresponded" },
  { value: "waiting", label: "Waiting" },
  { value: "archived", label: "Archived" },
];

const TYPE_LABELS: Array<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "dm", label: "DMs" },
  { value: "group", label: "Groups" },
];

interface FilterBarProps {
  state: StateFilter;
  type: TypeFilter;
  onStateChange: (state: StateFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
  onNewChat: () => void;
  onSearch: () => void;
}

export function FilterBar({
  state,
  type,
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
      <Tabs value={state} onValueChange={(value) => onStateChange(value as StateFilter)}>
        <TabsList className="w-full">
          {STATE_LABELS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="flex-1 text-xs">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tabs value={type} onValueChange={(value) => onTypeChange(value as TypeFilter)}>
        <TabsList className="h-7 w-full">
          {TYPE_LABELS.map((item) => (
            <TabsTrigger key={item.value} value={item.value} className="flex-1 text-xs">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
