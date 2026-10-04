import type { BlueBubbles } from "../bluebubbles";
import { mapScheduledMessage } from "../scheduled";
import type { ConvexIngest } from "./convex-ingest";
import { bbValue } from "./live";
import { RetryWork } from "./retry";

export async function publishScheduled(bb: Pick<BlueBubbles, "listScheduledMessages">, ingest: Pick<ConvexIngest, "post">): Promise<void> {
  const rows = bbValue(await bb.listScheduledMessages());
  const items = rows.map((raw) => {
    const item = mapScheduledMessage(raw, raw.payload.chatGuid);
    return { bbId: item.id, chatGuid: item.chatGuid, text: item.text, sendAt: item.sendAt,
      status: item.status, error: item.error ?? undefined, sentAt: item.sentAt ?? undefined };
  });
  await ingest.post("scheduled", { items });
}

export class ScheduledMirror {
  private timer: ReturnType<typeof setInterval>;
  private work: RetryWork;

  constructor(bb: Pick<BlueBubbles, "listScheduledMessages">, ingest: Pick<ConvexIngest, "post">) {
    this.work = new RetryWork("scheduled", () => publishScheduled(bb, ingest));
    this.timer = setInterval(() => this.work.request(), 5 * 60_000);
    this.timer.unref();
    this.work.request();
  }

  get pending(): number { return this.work.pending; }
  request(): void { this.work.request(); }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void { clearInterval(this.timer); this.work.stop(); }
}
