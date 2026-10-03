import { TypeRamp, type TypeRampScale } from "./tokens";

/** Mobile ramp. Legacy name; new code reads `useTypeRamp()`. */
export const Type: TypeRampScale = TypeRamp.mobile;

/**
 * The shipped desktop sizes. Title and caption sit one point under the target
 * ramp so existing screens do not move before the migration wave; that wave
 * points this at `TypeRamp.desktop` and deletes `useTypeRamp`.
 */
export const DesktopType: TypeRampScale = { ...TypeRamp.desktop, title: 14, caption: 10 };

export type TypeScale = TypeRampScale;
