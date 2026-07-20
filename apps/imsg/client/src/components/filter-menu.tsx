import type { StateCounts, StateFilter, TypeFilter } from "@shared/types";

import { ConversationFiltersModal } from "@/components/conversation-filters";
import type { InboxFilters } from "@/lib/inbox-model";

interface FilterMenuProps {
  visible: boolean;
  onClose: () => void;
  state: StateFilter;
  type: TypeFilter;
  counts: StateCounts | null;
  onStateChange: (state: StateFilter) => void;
  onTypeChange: (type: TypeFilter) => void;
}

/** @deprecated Use ConversationFiltersModal with a single InboxFilters value. */
export function FilterMenu({
  visible,
  onClose,
  state,
  type,
  counts,
  onStateChange,
  onTypeChange,
}: FilterMenuProps) {
  const filters: InboxFilters = { state, type };
  return (
    <ConversationFiltersModal
      visible={visible}
      onClose={onClose}
      filters={filters}
      counts={counts}
      onFiltersChange={(next) => {
        if (next.state !== state) onStateChange(next.state);
        if (next.type !== type) onTypeChange(next.type);
      }}
    />
  );
}
