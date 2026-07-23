import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { useTheme } from "@/hooks/use-theme";

/**
 * Shared list behavior for every palette surface (root search, compose, and
 * whatever ⌘K grows next): one cursor model, one reveal mechanism, one row
 * shell — so the views cannot drift apart in feel.
 */

/** Minimal-scroll reveal via the platform: locks the row flush at the edge
 * being moved toward, never recenters. Palette surfaces are web-only, so the
 * DOM primitive replaces hand-measured frame math (which drifted). */
export function revealPaletteRow(key: string): void {
  if (typeof document === "undefined") return;
  document
    .querySelector(`[data-palette-key="${CSS.escape(key)}"]`)
    ?.scrollIntoView({ block: "nearest" });
}

export interface PaletteCursor {
  readonly selectedIndex: number;
  setSelectedIndex(index: number): void;
  /** Clamped cursor step; reveals the target row. */
  move(delta: -1 | 1): void;
  /** Reset to the top (query changed — a NEW list, not churn). */
  reset(): void;
  /** Latest cursor position for stable keydown closures. */
  readonly indexRef: React.RefObject<number>;
}

/**
 * Roving cursor over a keyed list. Selection resets only via `reset()` (query
 * changes); live data churn merely clamps, so background refreshes can never
 * yank the scroll. Reveal fires on cursor moves alone.
 */
export function usePaletteCursor(keys: readonly string[]): PaletteCursor {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const indexRef = useRef(selectedIndex);
  indexRef.current = selectedIndex;

  useEffect(() => {
    if (keys.length > 0 && selectedIndex > keys.length - 1) {
      setSelectedIndex(keys.length - 1);
    }
  }, [keys.length, selectedIndex]);

  useEffect(() => {
    const key = keysRef.current[selectedIndex];
    if (key) revealPaletteRow(key);
  }, [selectedIndex]);

  // STABLE functions (ref-backed): consumers hang effects off `reset`, so a
  // per-render identity would re-fire them every render and pin the cursor
  // to row 0 (the bug that froze arrow navigation).
  const move = useCallback((delta: -1 | 1) => {
    setSelectedIndex(
      Math.max(0, Math.min(keysRef.current.length - 1, indexRef.current + delta)),
    );
  }, []);
  const reset = useCallback(() => setSelectedIndex(0), []);

  return { selectedIndex, setSelectedIndex, move, reset, indexRef };
}

/** Row shell: hover tracking, selection highlight, and the DOM key the reveal
 * mechanism targets. Content is the caller's. */
export function PaletteListRow({
  paletteKey,
  selected,
  disabled = false,
  onPress,
  onHover,
  children,
}: {
  paletteKey: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      // RNW renders dataSet as data-* attributes; RN's types don't know it.
      {...({ dataSet: { paletteKey } } as object)}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={onHover}
      style={[paletteStyles.row, selected && { backgroundColor: theme.backgroundSelected }]}
    >
      {children}
    </Pressable>
  );
}

export function PaletteSectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Text style={[paletteStyles.sectionHeader, { color: theme.textSecondary }]}>{title}</Text>
  );
}

export const paletteStyles = StyleSheet.create({
  sectionHeader: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    paddingBottom: 3,
    paddingHorizontal: 16,
    paddingTop: 12,
    textTransform: "uppercase",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  iconBadge: {
    alignItems: "center",
    borderRadius: 15,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: "500",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 1,
  },
  hint: {
    fontSize: 12,
  },
  enterHint: {
    fontSize: 13,
  },
  empty: {
    fontSize: 15,
    marginTop: 40,
    textAlign: "center",
  },
});
