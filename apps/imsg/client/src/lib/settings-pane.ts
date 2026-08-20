/** Bus for opening settings in the desktop right pane (wide layout) instead
 * of navigating to the full-screen modal route. Falls back to the modal when
 * no wide listener is subscribed — same shape as lib/selection.ts's
 * selectChat. */
type Listener = () => void;
const listeners = new Set<Listener>();

/** Returns true when a wide pane handled the open (caller skips the modal). */
export function openSettingsPane(): boolean {
  if (listeners.size === 0) return false;
  for (const listener of listeners) listener();
  return true;
}

export function onOpenSettingsPane(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
