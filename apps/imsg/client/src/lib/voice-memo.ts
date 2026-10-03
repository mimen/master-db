/** A press shorter than this is a click, not a voice memo. */
export const MIN_VOICE_MEMO_MS = 500;

export type VoiceMemoEnd = "send" | "cancel";

/** Decide what a finished recording does: only a deliberate, long-enough take is sent. */
export function voiceMemoOutcome(end: VoiceMemoEnd, durationMs: number): "send" | "discard" {
  return end === "send" && durationMs >= MIN_VOICE_MEMO_MS ? "send" : "discard";
}

export function formatRecordingClock(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
