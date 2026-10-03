import { batches, MessageWriter } from "./live";
import { RetryWork } from "./retry";

export class OverlayMirror {
  private dirty = new Set<string>();
  private full = true;
  private unsubscribe: () => void;
  private work: RetryWork;

  constructor(writer: MessageWriter) {
    this.work = new RetryWork("overlay", () => writer.exclusive(async () => {
      if (!writer.conversationIds.size) await writer.refreshChats();
      const queued = this.dirty;
      this.dirty = new Set();
      const full = this.full;
      this.full = false;
      try {
        for (const guid of queued) await writer.ensureChat(guid);
        const snapshot = writer.deps.db.overlaySnapshot();
        const allGuids = new Set([...snapshot.chatState, ...snapshot.triageEvents, ...snapshot.triageOpen].map((row) => row.chatGuid));
        // Deleting the last triage row still needs an empty scoped snapshot.
        for (const guid of queued) allGuids.add(guid);
        const groups = new Map<string, string[]>();
        for (const guid of allGuids) {
          const key = writer.conversationIds.get(guid) ?? guid;
          const group = groups.get(key) ?? [];
          group.push(guid);
          groups.set(key, group);
        }
        const changedIds = new Set([...queued].map((guid) => writer.conversationIds.get(guid) ?? guid));
        const selected = [...groups].filter(([id]) => full || changedIds.has(id)).map(([, guids]) => guids);
        for (const batch of batches(selected)) {
          // Siblings stay in one transaction so OR/max merges never lose a pin.
          const guids = new Set(batch.flat());
          const result = await writer.deps.ingest.post("overlay", {
            replaceChatGuids: [...guids],
            chatState: snapshot.chatState.filter((row) => guids.has(row.chatGuid)),
            triageEvents: snapshot.triageEvents.filter((row) => guids.has(row.chatGuid)),
            triageOpen: snapshot.triageOpen.filter((row) => guids.has(row.chatGuid)),
          });
          if (result.unresolved) console.warn(`comma bridge overlay: ${result.unresolved} unresolved rows`);
        }
      } catch (error) {
        for (const guid of queued) this.dirty.add(guid);
        this.full ||= full;
        throw error;
      }
    }));
    this.unsubscribe = writer.deps.db.onOverlayChange((chatGuid) => {
      this.dirty.add(chatGuid);
      this.work.request(100);
    });
    this.work.request();
  }

  get pending(): number { return this.dirty.size + this.work.pending; }
  requestFull(): void { this.full = true; this.work.request(); }
  flush(): Promise<void> { return this.work.flush(); }
  stop(): void { this.unsubscribe(); this.work.stop(); }
}
