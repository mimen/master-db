import { useEffect, useRef } from "react";

import type { ChatSummary, ConversationId } from "@shared/types";

import type { ConversationListViewport } from "./use-conversation-list-viewport";
import type { ConversationSearchController } from "./use-conversation-search";

import {
  neighborAfterRemoval,
  nextNavigationTarget,
  type InboxModel,
} from "@/lib/inbox-model";
import { registerFocusTarget, registerListAdapter, requestFocus } from "@/lib/keyboard/controller";

/**
 * Wires the conversation list into the keyboard system: registers the glide
 * ListAdapter (navigation follows the rendered order) and the `list-search`
 * focus target. Keyboard code
 * never touches list refs directly; it picks targets from
 * `model.navigationEntries` and asks the right viewport to reveal them.
 */
export function useConversationListKeyboard(args: {
  /** Adapter registration is desktop-only; the focus target is universal. */
  readonly enabled: boolean;
  readonly model: InboxModel;
  readonly selectedId: ConversationId | undefined;
  readonly viewport: ConversationListViewport;
  readonly search: ConversationSearchController;
  readonly onOpenChat: (chat: ChatSummary) => void;
  /** REQUIRED: glide moves must never fall back to opening (marking read). */
  readonly onPreviewChat: (chat: ChatSummary) => void;
}): void {
  const { enabled } = args;
  const stateRef = useRef(args);
  stateRef.current = args;

  useEffect(
    () =>
      registerFocusTarget("list-search", () => stateRef.current.search.inputRef.current),
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    return registerListAdapter({
      move(delta) {
        const { model, selectedId, onPreviewChat } = stateRef.current;
        const target = nextNavigationTarget(model.navigationEntries, selectedId, delta);
        if (!target || target.chat.conversationId === selectedId) return;
        onPreviewChat(target.chat);
        stateRef.current.viewport.revealEntry(target, delta);
      },
      activate() {
        const { model, selectedId, onOpenChat } = stateRef.current;
        const target =
          model.navigationEntries.find((e) => e.chat.conversationId === selectedId) ??
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
      selectNeighborOf(conversationId) {
        // Runs synchronously after the removal action, before re-render — so
        // the current model still contains `conversationId` and its neighbors.
        const { model, onPreviewChat } = stateRef.current;
        const neighbor = neighborAfterRemoval(model.navigationEntries, conversationId);
        if (neighbor) onPreviewChat(neighbor.chat);
      },
    });
  }, [enabled]);
}
