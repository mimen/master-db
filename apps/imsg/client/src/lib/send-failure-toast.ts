import { router } from "expo-router";
import { EXECUTOR_NAME } from "@shared/executors";
import { burstGate } from "./burst-gate";
import { messagingCommandError } from "./messaging-api";
import { onSendFailure, pendingSends } from "./pending-sends";
import { conversationRoute, selectChat } from "./selection";
import { showToast } from "./toast";

/**
 * A send that did not go out says so wherever the user is, since the usual path (send, settle, advance) has already
 * left its thread. Retry sends it again; Open goes to it. One toast per burst, across chats.
 */
export function installSendFailureToast(): () => void {
  const gate = burstGate(5_000);
  return onSendFailure(({ conversationId, bubble, error }) => {
    if (!gate()) return;
    const stillStranded = () => pendingSends.read(conversationId).some((m) => m.guid === bubble.guid && (m.sendState === "failed" || m.sendState === "notSent"));
    showToast(messagingCommandError(error, `Couldn't send. Check ${EXECUTOR_NAME[bubble.platform]} connection.`), [
      { label: "Retry", onPress: () => { if (stillStranded()) void pendingSends.retry(conversationId, bubble).catch(() => undefined); } },
      { label: "Open", onPress: () => { if (!selectChat({ conversationId })) router.push(conversationRoute(conversationId)); } },
    ]);
  });
}
