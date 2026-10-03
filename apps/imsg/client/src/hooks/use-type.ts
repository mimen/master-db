import { DesktopType, Type } from "@/constants/type-scale";
import { TypeRamp, type TypeRampScale } from "@/constants/tokens";

import { useLayoutMode } from "./use-layout-mode";

/** The shipped scale existing screens render at. */
export function useType(): TypeRampScale {
  const { wide } = useLayoutMode();
  return wide ? DesktopType : Type;
}

/** The target ramp. The `components/ui` primitives read this. */
export function useTypeRamp(): TypeRampScale {
  const { wide } = useLayoutMode();
  return wide ? TypeRamp.desktop : TypeRamp.mobile;
}
