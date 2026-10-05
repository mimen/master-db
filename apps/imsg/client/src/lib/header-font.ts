import type { TextStyle } from "react-native";

/**
 * Bricolage Grotesque 600, a static instance cut from the variable font so
 * every platform renders the same weight. Only the brand name, the lens tabs
 * and the thread title use it. Loaded by expo-font in the root layout.
 */
export const HEADER_FONT = "Bricolage Grotesque";

export const HEADER_FONT_SOURCE = require("../../assets/fonts/BricolageGrotesque-SemiBold.ttf") as number;

/** The face carries its own weight; a fontWeight here would synthesize bold on web. */
export const headerFace: TextStyle = { fontFamily: HEADER_FONT };
