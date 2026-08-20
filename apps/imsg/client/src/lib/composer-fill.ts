/**
 * Stack-aware signal bus for dropping text into the active composer. Overlay
 * composers (Sweep) temporarily sit above the underlying thread; removing the
 * overlay restores the previous listener instead of disconnecting all fills.
 * Suggestions always fill visible text for editing and never send.
 */
type Listener = (text: string) => void;

const listeners: Listener[] = [];

export function fillComposer(text: string): void {
  listeners[listeners.length - 1]?.(text);
}

export function onFillComposer(cb: Listener): () => void {
  listeners.push(cb);
  return () => {
    const index = listeners.lastIndexOf(cb);
    if (index >= 0) listeners.splice(index, 1);
  };
}
