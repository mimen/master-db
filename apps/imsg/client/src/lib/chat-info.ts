/** Tiny bus so the thread-pane info button (wide/desktop) can open the details
 * as a right-hand pane instead of navigating to the full-screen route. */
type Listener = (guid: string) => void;
const listeners = new Set<Listener>();

export function openChatInfo(guid: string): void {
  for (const l of listeners) l(guid);
}

export function onOpenChatInfo(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
