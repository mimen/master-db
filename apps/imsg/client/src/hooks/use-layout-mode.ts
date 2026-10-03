import { useWindowDimensions } from "react-native";
import { Breakpoints } from "@/constants/theme";

export interface LayoutMode {
  /** Raw window width, for call sites that need it for math alongside the predicates below. */
  width: number;
  /** True at/above `Breakpoints.wide` — the split-pane (list + thread) desktop layout. */
  wide: boolean;
}

/**
 * THE responsive seam: every screen/component that branches on window width
 * reads it from here. `width >= 768` is not written inline
 * anywhere else in the app — if a call site needs the breakpoint predicate,
 * it calls this hook instead of re-deriving it from `useWindowDimensions`.
 */
export function useLayoutMode(): LayoutMode {
  const { width } = useWindowDimensions();
  const wide = width >= Breakpoints.wide;
  return { width, wide };
}
