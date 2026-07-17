/**
 * Faster long-press for touch: dispatches a synthetic `contextmenu` event
 * after `delayMs` (Radix's built-in long-press is a fixed ~700ms).
 * Plain factory (no hooks) so it can be used inside list renders — spread the
 * returned handlers onto the ContextMenuTrigger child.
 */
export function longPress(delayMs = 350) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const target = e.currentTarget;
      start = { x: touch.clientX, y: touch.clientY };
      cancel();
      timer = setTimeout(() => {
        target.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
          }),
        );
      }, delayMs);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || !start) return;
      // Finger drifted — it's a scroll, not a long-press.
      if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) {
        cancel();
      }
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  };
}
