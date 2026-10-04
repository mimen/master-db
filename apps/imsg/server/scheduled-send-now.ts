import type { BBScheduledMessage } from "./bb-types";
import type { Result } from "./bluebubbles";

export interface ScheduledSendNowSeam {
  listScheduledMessages(): Promise<Result<BBScheduledMessage[]>>;
  updateScheduledMessage(
    id: number,
    chatGuid: string,
    text: string,
    sendAt: number,
  ): Promise<Result<BBScheduledMessage>>;
}

const claimsBySeam = new WeakMap<ScheduledSendNowSeam, Set<number>>();

/**
 * Hands "Send now" back to BlueBubbles' durable scheduler instead of deleting
 * the row and sending through a second path. Moving the existing one-shot job
 * to the immediate future preserves its exactly-once ownership across crashes
 * and concurrent requests; the scheduler remains the only sender.
 */
export class ScheduledSendNow {
  private claims: Set<number>;

  constructor(
    private seam: ScheduledSendNowSeam,
    private now: () => number = Date.now,
  ) {
    // REST and outbox commands share the same scheduler claim guard.
    this.claims = claimsBySeam.get(seam) ?? new Set<number>();
    claimsBySeam.set(seam, this.claims);
  }

  async send(id: number): Promise<Result<BBScheduledMessage>> {
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "invalid schedule id" };
    if (this.claims.has(id)) return { ok: false, error: "scheduled message is already claimed" };
    this.claims.add(id);
    try {
      const listed = await this.seam.listScheduledMessages();
      if (!listed.ok) return listed;
      const scheduled = listed.value.find((item) => Number(item.id) === id);
      if (!scheduled) return { ok: false, error: "scheduled message not found" };
      if (scheduled.type !== "send-message") return { ok: false, error: "unsupported schedule type" };
      const chatGuid = scheduled.payload.chatGuid?.trim();
      const text = scheduled.payload.message?.trim();
      if (!chatGuid || !text) return { ok: false, error: "scheduled message payload is invalid" };

      // A tiny future offset gives the scheduler time to persist and observe the
      // update without introducing a second outbound send path.
      return await this.seam.updateScheduledMessage(id, chatGuid, text, this.now() + 250);
    } finally {
      this.claims.delete(id);
    }
  }
}
