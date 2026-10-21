import Ionicons from "@expo/vector-icons/Ionicons";
import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { useConvex } from "convex/react";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PaneHeader } from "@/components/ui/pane-header";
import { Space } from "@/constants/tokens";
import { useAgentChat } from "@/hooks/use-agent";
import { useChatDirectory, useConversationRef } from "@/hooks/use-chat-directory";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useTheme } from "@/hooks/use-theme";
import { useTypeRamp } from "@/hooks/use-type";
import { agentApi, agentItemKey, type AgentAttachmentMeta, type AgentItem, type AgentItemId } from "@/lib/agent-api";
import { agentModelChoice, type AgentModelChoice } from "@/lib/agent-models";
import { attachmentPreviews } from "@/lib/agent-pane";
import { agentIsRunning, liveStatus, promptHistory, transcriptRows } from "@/lib/agent-transcript";
import { useAgentSettings } from "@/lib/settings";
import { showToast } from "@/lib/toast";

import { AgentInput, type SendIntent } from "./agent-input";
import { TranscriptRowView, WorkingStatus, type TranscriptActions } from "./agent-transcript";
import { useLiveFollow } from "./use-live-follow";
import { resolveComposerDispatchMode } from "./vendor/composer-dispatch";

/** An ask the user just sent, drawn until the server's copy (same key) arrives. */
function pendingAsk(key: string, text: string, steer: boolean, attachments: AgentAttachmentMeta[], now: number): AgentItem {
  return {
    _id: key as AgentItemId, _creationTime: now, chatId: "" as AgentItem["chatId"], key,
    ordinal: Number.MAX_SAFE_INTEGER, entry: { kind: "user", text, steer, ...(attachments.length ? { attachments } : {}) }, createdAt: now, updatedAt: now,
  };
}

export function AgentPane({ chatGuid, onClose }: { readonly chatGuid: string; readonly onClose?: () => void }) {
  const theme = useTheme();
  const type = useTypeRamp();
  const convex = useConvex();
  const settings = useAgentSettings();
  const name = useChatDirectory()?.find((chat) => chat.guid === chatGuid)?.displayName ?? "this conversation";
  const { conversationId } = useConversationRef(chatGuid);
  const { chat, items } = useAgentChat(conversationId);
  const [pending, setPending] = useState<readonly AgentItem[]>([]);
  const { scrollProps, follow, disclosure } = useLiveFollow();
  const running = agentIsRunning(chat?.state);
  const keyboardHeight = useKeyboardHeight();
  // A pick in the input lasts for this conversation until it is sent; the chat then remembers it.
  const [picked, setPicked] = useState<{ readonly conversationId: string; readonly choice: AgentModelChoice } | null>(null);
  const choice = picked && picked.conversationId === conversationId
    ? picked.choice
    : chat ? agentModelChoice(chat.model, chat.effort) : agentModelChoice(settings.agentModel, settings.agentEffort);
  const history = useMemo(() => promptHistory(items), [items]);

  const shownPending = pending.filter((ask) => !items.some((item) => item.key === ask.key));
  const rows = transcriptRows([...items, ...shownPending]);
  const newestQuestion = rows.findLast((row) => row.kind === "item" && row.item.entry.kind === "question" && row.item.entry.status === "pending")?.key;

  const send = ({ text, alternate, attachments }: SendIntent) => {
    if (!conversationId) return;
    const steer = resolveComposerDispatchMode({ running, alternateModifier: alternate }) === "steer";
    const key = agentItemKey();
    const meta = attachments.map((attachment) => ({ filename: attachment.name, mimeType: attachment.mime, size: attachment.blob?.size ?? attachment.size ?? 0 }));
    if (attachments.length) attachmentPreviews.set(key, attachments.map((attachment) => attachment.isImage ? attachment.uri : undefined));
    setPending((current) => [...current, pendingAsk(key, text, steer, meta, Date.now())]);
    follow();
    Promise.all(attachments.map(async (attachment) => {
      const file = { filename: attachment.name, mimeType: attachment.mime };
      // Loaded on use, like the pickers: the composer shares this module, and a static import would put it in the first visit.
      const { storeAttachment } = await import("@/lib/attachment-upload");
      const stored = await storeAttachment(attachment.blob ? { ...file, blob: attachment.blob } : { ...file, uri: attachment.uri });
      return { ...file, ...stored };
    }))
      .then((stored) => convex.mutation(agentApi.ask, {
        conversationId, key, text, steer, model: choice.model, effort: choice.effort, ...(stored.length ? { attachments: stored } : {}),
      }))
      .catch(() => {
        setPending((current) => current.filter((ask) => ask.key !== key));
        showToast(attachments.length ? "Couldn't send the files to the agent. Try again." : "Couldn't reach the agent. Try again.");
      });
  };

  const chatId = chat?._id;
  const actions = useMemo<TranscriptActions>(() => ({
    onAnswer: async (requestId, answers) => {
      if (chatId) await convex.mutation(agentApi.answer, { chatId, requestId, answers });
    },
    onUseDraft: async (item) => {
      await convex.mutation(agentApi.useDraft, { itemId: item._id });
    },
    onDisclosure: disclosure,
  }), [chatId, convex, disclosure]);

  const startOver = () => {
    if (!conversationId) return;
    setPending([]);
    setPicked(null);
    convex.mutation(agentApi.newChat, { conversationId }).catch(() => showToast("Couldn't start a new chat. Try again."));
  };

  return (
    <View testID="agent-pane" style={[styles.root, { backgroundColor: theme.background, paddingBottom: keyboardHeight }]} {...({ dataSet: { agentPane: "true" } } as object)}>
      <PaneHeader
        title="Agent"
        detail={name}
        leading={<HugeiconsIcon icon={AiChat02Icon} size={18} color={theme.text} strokeWidth={1.6} />}
        actions={<>
          <Button label="New chat" onPress={startOver} disabled={!chat || items.length === 0} />
          {onClose ? (
            <IconButton label="Close agent" onPress={onClose}>
              {({ active }) => <Ionicons name="close" size={18} color={active ? theme.text : theme.icon} />}
            </IconButton>
          ) : null}
        </>}
      />
      <ScrollView {...scrollProps} style={styles.scroll} contentContainerStyle={styles.transcript} keyboardShouldPersistTaps="handled">
        {rows.length === 0 ? (
          <Text style={[styles.empty, { color: theme.textTertiary, fontSize: type.body }]}>
            Ask about {name}. The agent reads the recent messages and can draft a reply.
          </Text>
        ) : rows.map((row) => <TranscriptRowView key={row.key} row={row} shortcuts={row.key === newestQuestion} actions={actions} />)}
        <WorkingStatus chatKey={chat?._id ?? ""} status={liveStatus(chat?.state, items)} />
      </ScrollView>
      <AgentInput
        running={running}
        history={history}
        choice={choice}
        onChoice={(next) => {
          if (conversationId) setPicked({ conversationId, choice: next });
        }}
        onSend={send}
        onStop={() => {
          if (chat) convex.mutation(agentApi.stop, { chatId: chat._id }).catch(() => showToast("Couldn't stop the agent. Try again."));
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
});
