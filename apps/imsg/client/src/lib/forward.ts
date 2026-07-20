/** Holds the text being forwarded between the message sheet and the picker. */
let pending: string | null = null;

export function setForwardText(text: string): void {
  pending = text;
}

export function takeForwardText(): string | null {
  const t = pending;
  pending = null;
  return t;
}
