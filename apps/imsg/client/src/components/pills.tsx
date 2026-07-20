import type { StateCounts, StateFilter, TypeFilter } from "@shared/types";

import { ConversationFilters } from "@/components/conversation-filters";
import type { InboxFilters } from "@/lib/inbox-model";

interface PillBarProps {
  state: StateFilter;
  type: TypeFilter;
  counts: StateCounts | null;
  onStateChange: (state: StateFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
}

/** @deprecated Use ConversationFilters with a single InboxFilters value. */
export function PillBar({ state, type, counts, onStateChange, onTypeChange }: PillBarProps) {
  const filters: InboxFilters = { state, type };
  return (
    <ConversationFilters
      filters={filters}
      counts={counts}
      onFiltersChange={(next) => {
        if (next.state !== state) onStateChange(next.state);
        if (next.type !== type) onTypeChange(next.type);
      }}
    />
  );
}
