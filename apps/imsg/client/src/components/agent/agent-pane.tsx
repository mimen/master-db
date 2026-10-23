import Ionicons from "@expo/vector-icons/Ionicons";
import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { useConvex } from "convex/react";
import { useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PaneHeader } from "@/components/ui/pane-header";
import { Radius, Space } from "@/constants/tokens";
import { useAgentChats, useAgentItems } from "@/hooks/use-agent";
import { useChatDirectory, useConversationRef } from "@/hooks/use-chat-directory";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { agentApi, agentItemKey, type AgentAttachmentMeta, type AgentChatId, type AgentItem, type AgentItemId } from "@/lib/agent-api";
import type { PaneSelection } from "@/lib/agent-chats";
import { agentModelChoice, type AgentModelChoice } from "@/lib/agent-models";
import { attachmentPreviews } from "@/lib/agent-pane";
import { agentIsRunning, liveStatus, promptHistory, transcriptRows } from "@/lib/agent-transcript";
import { formatReceiptTime } from "@/lib/format";
import { useAgentSettings } from "@/lib/settings";
import { showToast } from "@/lib/toast";

import { AgentInput, type SendIntent } from "./agent-input";
import { TranscriptRowView, WorkingStatus, type TranscriptActions } from "./agent-transcript";
import { ChatSwitcher } from "./chat-switcher";
import { useLiveFollow } from "./use-live-follow";
import { useMarkSeen, usePaneSelection } from "./use-pane-chat";
import { resolveComposerDispatchMode } from "./vendor/composer-dispatch";

/** A new chat's pending asks carry this until its first ask returns the chat id. */
const NEW_CHAT = "" as AgentChatId;

/** An ask the user just sent, drawn in its chat until the server's copy (same key) arrives. */
function pendingAsk(chatId: AgentChatId, key: string, text: string, steer: boolean, attachments: AgentAttachmentMeta[], now: number): AgentItem {
  return {
    _id: key as AgentItemId, _creationTime: now, chatId, key,
    ordinal: Number.MAX_SAFE_INTEGER, entry: { kind: "user", text, steer, ...(attachments.length ? { attachments } : {}) }, createdAt: now, updatedAt: now,
  };
}

export function AgentPane({ chatGuid, requestedChatId, onClose }: {
  readonly chatGuid: string;
  /** The phone route's `chat` param; the wide shell passes requests through openAgentPane instead. */
  readonly requestedChatId?: string;
  readonly onClose?: () => void;
}) {
  const theme = useTheme();
  const type = useTypeRamp();
  const convex = useConvex();
  const settings = useAgentSettings();
  const name = useChatDirectory()?.find((chat) => chat.guid === chatGuid)?.displayName ?? "this conversation";
  const { conversationId } = useConversationRef(chatGuid);
  const chats = useAgentChats(conversationId);
  const [selection, select] = usePaneSelection(chatGuid, requestedChatId, chats);
  const chatId = selection?.kind === "chat" ? selection.chatId : undefined;
  const chat = chats?.find((row) => row._id === chatId);
  const items = useAgentItems(chatId);
  useMarkSeen(chat);
  const [pending, setPending] = useState<readonly AgentItem[]>([]);
  // The first ask of a new chat creates it; a second ask sent before that returns waits for its id.
  const creating = useRef<Promise<AgentChatId> | null>(null);
  const { scrollProps, follow, disclosure } = useLiveFollow();
  const running = agentIsRunning(chat?.state);
  const keyboardHeight = useKeyboardHeight();
  const { wide } = useLayoutMode();
  // A pick in the input lasts for the shown chat; once sent, the chat carries it.
  const [picked, setPicked] = useState<{ readonly chatId: AgentChatId; readonly choice: AgentModelChoice } | null>(null);
  const shownId = chatId ?? NEW_CHAT;
  const choice = picked?.chatId === shownId ? picked.choice
    : chat ? agentModelChoice(chat.model, chat.effort) : agentModelChoice(settings.agentModel, settings.agentEffort);
  const history = useMemo(() => promptHistory(items), [items]);

  const shownPending = pending.filter((ask) => ask.chatId === shownId && !items.some((item) => item.key === ask.key));
  const rows = transcriptRows([...items, ...shownPending]);
  const newestQuestion = rows.findLast((row) => row.kind === "item" && row.item.entry.kind === "question" && row.item.entry.status === "pending")?.key;

  const created = (id: AgentChatId) => {
    setPending((current) => current.map((ask) => ask.chatId === NEW_CHAT ? { ...ask, chatId: id } : ask));
    setPicked((current) => current?.chatId === NEW_CHAT ? { ...current, chatId: id } : current);
    select((current) => current?.kind === "new" ? { kind: "chat", chatId: id } : current);
  };

  const send = ({ text, alternate, attachments }: SendIntent) => {
    if (!conversationId || !selection) return;
    const steer = resolveComposerDispatchMode({ running, alternateModifier: alternate }) === "steer";
    const key = agentItemKey();
    const meta = attachments.map((attachment) => ({ filename: attachment.name, mimeType: attachment.mime, size: attachment.blob?.size ?? attachment.size ?? 0 }));
    if (attachments.length) attachmentPreviews.set(key, attachments.map((attachment) => attachment.isImage ? attachment.uri : undefined));
    setPending((current) => [...current, pendingAsk(shownId, key, text, steer, meta, Date.now())]);
    follow();
    const target = chatId ?? creating.current ?? undefined;
    const asked = Promise.all(attachments.map(async (attachment) => {
      const file = { filename: attachment.name, mimeType: attachment.mime };
      // Loaded on use, like the pickers: the composer shares this module, and a static import would put it in the first visit.
      const { storeAttachment } = await import("@/lib/attachment-upload");
      const stored = await storeAttachment(attachment.blob ? { ...file, blob: attachment.blob } : { ...file, uri: attachment.uri });
      return { ...file, ...stored };
    }))
      .then(async (stored) => convex.mutation(agentApi.ask, {
        conversationId, chatId: await target, key, text, steer, model: choice.model, effort: choice.effort, ...(stored.length ? { attachments: stored } : {}),
      }));
    if (!target) {
      creating.current = asked;
      asked.then(created, () => undefined).finally(() => {
        if (creating.current === asked) creating.current = null;
      });
    }
    asked.catch(() => {
      setPending((current) => current.filter((ask) => ask.key !== key));
      showToast(attachments.length ? "Couldn't send the files to the agent. Try again." : "Couldn't reach the agent. Try again.");
    });
  };

  const actions = useMemo<TranscriptActions>(() => ({
    onAnswer: async (requestId, answers) => {
      if (chatId) await convex.mutation(agentApi.answer, { chatId, requestId, answers });
    },
    onUseDraft: async (item) => {
      await convex.mutation(agentApi.useDraft, { itemId: item._id });
    },
    onDisclosure: disclosure,
  }), [chatId, convex, disclosure]);

  const settled = chat?.settledAt;
  const choose = (next: PaneSelection) => {
    if (next.kind === "new") creating.current = null;
    select(next);
    follow();
  };
  const settle = () => {
    if (chatId) convex.mutation(agentApi.settle, { chatId }).catch(() => showToast("Couldn't settle the chat. Try again."));
  };
  const reopen = () => {
    if (chatId) convex.mutation(agentApi.reopen, { chatId }).catch(() => showToast("Couldn't reopen the chat. Try again."));
  };

  return (
    <View testID="agent-pane" style={[styles.root, { backgroundColor: theme.background, paddingBottom: keyboardHeight }]} {...({ dataSet: { agentPane: "true" } } as object)}>
      <PaneHeader
        title={selection ? <ChatSwitcher chats={chats ?? []} name={name} selection={selection} onSelect={choose} /> : "Agent"}
        leading={<HugeiconsIcon icon={AiChat02Icon} size={18} color={theme.text} strokeWidth={1.6} />}
        actions={<>
          {chat && settled === undefined ? <Button label="Settle" onPress={settle} /> : null}
          {/* A phone's header has no room for it beside the title; the switcher's menu carries New chat. */}
          {wide ? <Button label="New chat" onPress={() => choose({ kind: "new" })} disabled={selection?.kind !== "chat"} /> : null}
          {onClose ? (
            <IconButton label="Close agent" onPress={onClose}>
              {({ active }) => <Ionicons name="close" size={18} color={active ? theme.text : theme.icon} />}
            </IconButton>
          ) : null}
        </>}
      />
      {settled !== undefined ? (
        <View testID="agent-settled-bar" style={[styles.settledBar, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.settledText, { color: theme.textSecondary, fontSize: type.secondary }]}>Settled {formatReceiptTime(settled)}</Text>
          <Button label="Reopen" onPress={reopen} style={styles.reopen} />
        </View>
      ) : null}
      <ScrollView {...scrollProps} style={styles.scroll} contentContainerStyle={styles.transcript} keyboardShouldPersistTaps="handled">
        {rows.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textTertiary, fontSize: type.body }]}>
            Ask about {name}. The agent reads the recent messages and can draft a reply.
          </Text>
        ) : rows.map((row) => <TranscriptRowView key={row.key} row={row} shortcuts={row.key === newestQuestion} actions={actions} />)}
        <WorkingStatus chatKey={shownId} status={liveStatus(chat?.state, items)} />
      </ScrollView>
      <AgentInput
        running={running}
        history={history}
        choice={choice}
        onChoice={(next) => setPicked({ chatId: shownId, choice: next })}
        onSend={send}
        onStop={() => {
          if (chatId) convex.mutation(agentApi.stop, { chatId }).catch(() => showToast("Couldn't stop the agent. Try again."));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  transcript: { gap: Space.lg, padding: Space.gutter },
  empty: { lineHeight: 20, paddingTop: Space.x3, textAlign: "center" },
  settledBar: {
    alignItems: "center",
    borderRadius: Radius.md,
    flexDirection: "row",
    gap: Space.md,
    marginHorizontal: Space.gutter,
    marginTop: Space.md,
    paddingLeft: Space.lg,
    paddingRight: Space.xs,
    paddingVertical: Space.xs,
  },
  settledText: { flex: 1 },
  reopen: { height: 28, paddingHorizontal: Space.md },
});
