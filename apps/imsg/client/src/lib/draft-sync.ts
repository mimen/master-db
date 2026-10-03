export type RemoteDraft = { text: string; updatedAt: number } | null;

type MergeState = {
  text: string;
  focused: boolean;
  dirty: boolean;
  pending: boolean;
  initial: boolean;
  updatedAt: number;
};

export function mergeRemoteDraft(state: MergeState, remote: RemoteDraft): string | undefined {
  if (state.pending || (state.focused && state.dirty)) return undefined;
  if (state.initial && state.text !== "") return undefined;
  if (remote && remote.updatedAt < state.updatedAt) return undefined;
  return remote?.text ?? "";
}

export function createDraftSync({ text, write, onRemote, onError }: {
  text: string;
  write: (text: string) => Promise<unknown>;
  onRemote: (text: string) => void;
  onError: () => void;
}) {
  const state: MergeState = { text, focused: false, dirty: false, pending: false, initial: true, updatedAt: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: string | undefined;
  let revision = 0;
  let writes = Promise.resolve();

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    if (queued === undefined) return writes;
    const value = queued;
    const version = revision;
    queued = undefined;
    writes = writes.then(async () => {
      try {
        await write(value);
        if (version === revision) state.pending = false;
      } catch {
        if (version === revision) queued = value;
        onError();
      }
    });
    return writes;
  };

  return {
    save(value: string) {
      state.text = value;
      state.dirty = true;
      state.pending = true;
      queued = value;
      revision++;
      clearTimeout(timer);
      if (value === "") void flush();
      else timer = setTimeout(() => void flush(), 600);
    },
    focus() { state.focused = true; },
    blur() {
      state.focused = false;
      state.dirty = false;
      return flush();
    },
    flush,
    receive(remote: RemoteDraft) {
      const next = mergeRemoteDraft(state, remote);
      state.initial = false;
      state.updatedAt = Math.max(state.updatedAt, remote?.updatedAt ?? 0);
      if (next !== undefined && next !== state.text) {
        state.text = next;
        onRemote(next);
      }
    },
  };
}
