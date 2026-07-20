/** Tiny bus so header buttons (native + split-pane) can open the in-thread
 * search shelf that lives inside ThreadView. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function openThreadSearch(): void {
  for (const l of listeners) l();
}

export function onOpenThreadSearch(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
