import { useEffect, useRef } from "react";

import type { ChatSummary } from "@shared/types";

import type { PriorityShelfHandle } from "../priority-shelf";

import type { ConversationListViewport } from "./use-conversation-list-viewport";
import type { ConversationSearchController } from "./use-conversation-search";

import {
  neighborAfterRemoval,
  nextNavigationTarget,
  type InboxModel,
  type InboxNavigationEntry,
} from "@/lib/inbox-model";
import { registerFocusTarget, registerListAdapter, requestFocus } from "@/lib/keyboard/controller";

/**
 * Wires the conversation list into the keyboard system: registers the glide
 * ListAdapter (navigation follows the RENDERED order — priority shelf first,
 * then the filtered list) and the `list-search` focus target. Keyboard code
 * never touches list refs directly; it picks targets from
 * `model.navigationEntries` and asks the right viewport to reveal them.
 */
export function useConversationListKeyboard(args: {
  /** Adapter registration is desktop-only; the focus target is universal. */
  readonly enabled: boolean;
  readonly model: InboxModel;
  readonly selectedGuid: string | undefined;
  readonly viewport: ConversationListViewport;
  readonly search: ConversationSearchController;
  readonly shelf: React.RefObject<PriorityShelfHandle | null>;
  readonly onOpenChat: (chat: ChatSummary) => void;
  /** REQUIRED: glide moves must never fall back to opening (marking read). */
  readonly onPreviewChat: (chat: ChatSummary) => void;
}): void {
  const { enabled, shelf } = args;
  const stateRef = useRef(args);
  stateRef.current = args;

  useEffect(
    () =>
      registerFocusTarget("list-search", () =>
        stateRef.current.search.inputRef.current?.focus(),
      ),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const reveal = (entry: InboxNavigationEntry, delta: -1 | 1): void => {
      stateRef.current.viewport.revealEntry(entry, delta);
      if (entry.location.kind === "priority") {
        // The shelf is horizontal — vertical reveal only reaches the header;
        // the shelf itself pins the item into its visible band.
        shelf.current?.reveal(entry.location.index, delta);
      }
    };
    return registerListAdapter({
      move(delta) {
        const { model, selectedGuid, onPreviewChat } = stateRef.current;
        const target = nextNavigationTarget(model.navigationEntries, selectedGuid, delta);
        if (!target || target.chat.guid === selectedGuid) return;
        onPreviewChat(target.chat);
        reveal(target, delta);
      },
      activate() {
        const { model, selectedGuid, onOpenChat } = stateRef.current;
        const target =
          model.navigationEntries.find((e) => e.chat.guid === selectedGuid) ??
          model.navigationEntries[0];
        if (target) onOpenChat(target.chat);
      },
      focusSearch() {
        // The field is the list header on desktop — reveal it, then focus via
        // the registry (pending-focus handles a not-yet-mounted field; no
        // timer-based sequencing).
        stateRef.current.viewport.scrollToTop();
        requestFocus("list-search");
      },
      clearSearch() {
        return stateRef.current.search.clear();
      },
      selectNeighborOf(guid) {
        // Runs synchronously after the removal action, before re-render — so
        // the current model still contains `guid` and its neighbors.
        const { model, onPreviewChat } = stateRef.current;
        const neighbor = neighborAfterRemoval(model.navigationEntries, guid);
        if (neighbor) onPreviewChat(neighbor.chat);
      },
    });
  }, [enabled, shelf]);
}
