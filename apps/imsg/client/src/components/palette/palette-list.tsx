import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  const c = useTheme();
  return (
    <Pressable
      // RNW renders dataSet as data-* attributes; RN's types don't know it.
      {...({ dataSet: { paletteKey } } as object)}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      // Hover moves the palette cursor; the selection fill IS the hover
      // feedback, so no separate hover fill here.
      onHoverIn={onHover}
      style={[paletteStyles.row, selected && { backgroundColor: c.popSelected }]}
    >
      {children}
    </Pressable>
  );
}

export function PaletteSectionHeader({ title, trailing }: { title: string; trailing?: string }) {
  const c = useTheme();
  return (
    <View style={paletteStyles.sectionHeader}>
      <Text style={[paletteStyles.sectionHeaderText, { color: c.popTertiary }]}>{title}</Text>
      {trailing && <Text style={[paletteStyles.sectionHeaderText, { color: c.popTertiary }]}>{trailing}</Text>}
    </View>
  );
}

export const paletteStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 5,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  sectionHeaderText: {
    fontSize: 11.5,
  },
  row: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 11,
    marginBottom: 2,
    marginHorizontal: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  iconBadge: {
    alignItems: "center",
    borderRadius: 6,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13.5,
  },
  subtitle: {
    fontSize: 12.5,
  },
  hint: {
    fontSize: 12,
  },
  kbd: {
    borderRadius: 5,
    borderWidth: 1,
    fontSize: 11,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  empty: {
    fontSize: 13.5,
    marginVertical: 28,
    textAlign: "center",
  },
});
