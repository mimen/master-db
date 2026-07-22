/** Bus for opening a contact in the desktop right pane (over the details view,
 * with a back button). Fired from the thread header name and detail participants. */
export interface PersonTarget {
  address: string;
  name: string;
  /** The chat whose Details the back button returns to. */
  backGuid: string;
}

type Listener = (target: PersonTarget) => void;
const listeners = new Set<Listener>();

export function openPersonPane(target: PersonTarget): void {
  for (const l of listeners) l(target);
}

export function onOpenPersonPane(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
