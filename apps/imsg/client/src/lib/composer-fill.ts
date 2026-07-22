/**
 * Signal bus for dropping text into the composer, matching the thread-search
 * bus. The suggestion shelf uses it: tapping a suggestion fills the input for
 * editing — it is never sent automatically.
 */
type Listener = (text: string) => void;

let listener: Listener | null = null;

export function fillComposer(text: string): void {
  listener?.(text);
}

export function onFillComposer(cb: Listener): () => void {
  listener = cb;
  return () => {
    if (listener === cb) listener = null;
  };
}
