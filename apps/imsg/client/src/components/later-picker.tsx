import { useEffect, useState, type ReactElement } from "react";
import { deferChat, onPickRequest, type PickRequest } from "@/lib/later";
import { ScheduleEditor } from "./schedule-editor";

/** Later's and Follow up's Pick date card, opened from either menu wherever it was raised. */
export function LaterPicker(): ReactElement | null {
  const [request, setRequest] = useState<PickRequest | null>(null);
  useEffect(() => onPickRequest(setRequest), []);
  if (!request) return null;
  const later = request.kind === "later";
  return (
    <ScheduleEditor
      visible
      title={later ? `Snooze ${request.chat.displayName} until` : `Follow up with ${request.chat.displayName} if no reply by`}
      initialText=""
      initialSendAt={Date.now() + 86_400_000}
      textEditable={false}
      failure={later ? "Couldn't snooze" : "Couldn't set the follow-up"}
      onClose={() => setRequest(null)}
      onSubmit={async (_text, at) => {
        deferChat(request.chat, request.kind, at);
        request.onPicked?.();
      }}
    />
  );
}
