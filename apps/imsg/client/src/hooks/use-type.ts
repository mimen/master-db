import { DesktopType, Type, type TypeScale } from "@/constants/type-scale";

import { useLayoutMode } from "./use-layout-mode";

/** Mobile keeps the iOS scale; wide/desktop uses the denser Mac-sized one. */
export function useType(): TypeScale {
  const { wide } = useLayoutMode();
  return wide ? DesktopType : Type;
}
