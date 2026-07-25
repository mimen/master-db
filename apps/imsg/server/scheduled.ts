import type { BBScheduledMessage, BBScheduledMessageRequest } from "./bb-types";
import type { ScheduledMessage, ScheduledMessageStatus } from "../shared/types";

function epochMs(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeScheduledStatus(
  status: BBScheduledMessage["status"],
  error: string | null,
): ScheduledMessageStatus {
  if (!status) return "pending";
  if (status !== "error") return status;
  const detail = (error ?? "").toLowerCase();
  if (detail.includes("expired")) return "expired";
  if (detail.includes("restarted") || detail.includes("interrupted")) return "interrupted";
  return "failed";
}

export function mapScheduledMessage(raw: BBScheduledMessage, chatName: string): ScheduledMessage {
  const error = raw.error?.trim() || null;
  return {
    id: raw.id,
    chatGuid: raw.payload.chatGuid,
    chatName,
    text: raw.payload.message,
    sendAt: epochMs(raw.scheduledFor) ?? 0,
    status: normalizeScheduledStatus(raw.status, error),
    error,
    sentAt: epochMs(raw.sentAt),
  };
}

export function scheduledMessageRequest(
  chatGuid: string,
  text: string,
  sendAt: number,
  method: "private-api" | "apple-script",
): BBScheduledMessageRequest {
  return {
    type: "send-message",
    payload: { chatGuid, message: text, method },
    scheduledFor: sendAt,
    schedule: { type: "once" },
  };
}
