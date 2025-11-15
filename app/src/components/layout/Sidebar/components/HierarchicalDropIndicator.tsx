import type { DropZone } from "@/lib/dnd/types";

interface HierarchicalDropIndicatorProps {
  /** Current drop zone being hovered over */
  dropZone: DropZone;

  /** Whether the drop is valid (affects color) */
  isValid: boolean;

  /** Bounding rect of the target project element */
  targetRect: DOMRect;
}

/**
 * Visual indicator showing where a project will land when dropped
 *
 * Shows:
 * - Horizontal line (blue/green if valid, red if invalid)
 * - Indentation offset based on target level
 * - Positioned absolutely over the project list
 */
export function HierarchicalDropIndicator({ dropZone, isValid, targetRect }: HierarchicalDropIndicatorProps) {
  const { position, vertical, newLevel } = dropZone;

  // Calculate indentation (16px per level)
  const indentOffset = newLevel * 16;

  // Determine line position
  let top: number;
  let showLine = true;

  if (position === "right" && vertical === "inside") {
    // Making child - show background highlight instead of line
    showLine = false;
  } else if (vertical === "before") {
    // Insert before - line at top of target
    top = targetRect.top;
  } else {
    // Insert after - line at bottom of target
    top = targetRect.bottom;
  }

  // Color based on validity
  const color = isValid ? "rgb(59, 130, 246)" : "rgb(239, 68, 68)"; // blue-500 : red-500

  return (
    <>
      {/* Horizontal line indicator */}
      {showLine && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            top: `${top}px`,
            left: `${targetRect.left + indentOffset}px`,
            width: `${targetRect.width - indentOffset}px`,
            height: "2px",
            backgroundColor: color,
            boxShadow: `0 0 4px ${color}`,
          }}
        />
      )}

      {/* Background highlight for "inside" drops */}
      {!showLine && (
        <div
          className="pointer-events-none fixed z-40"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
            backgroundColor: isValid ? "rgba(59, 130, 246, 0.1)" : "rgba(239, 68, 68, 0.1)",
            border: `2px solid ${color}`,
            borderRadius: "4px",
          }}
        />
      )}

      {/* Left zone indicator (outdent) */}
      {position === "left" && (
        <div
          className="pointer-events-none fixed z-40"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.left}px`,
            width: "4px",
            height: `${targetRect.height}px`,
            backgroundColor: color,
          }}
        />
      )}

      {/* Right zone indicator (indent) */}
      {position === "right" && vertical === "inside" && (
        <div
          className="pointer-events-none fixed z-40"
          style={{
            top: `${targetRect.top}px`,
            left: `${targetRect.right - 4}px`,
            width: "4px",
            height: `${targetRect.height}px`,
            backgroundColor: color,
          }}
        />
      )}
    </>
  );
}
