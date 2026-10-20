import { Platform, type TextStyle } from "react-native";

/**
 * Bricolage Grotesque 600, a static instance cut from the variable font so
 * every platform renders the same weight. Only the brand name, the lens tabs
 * and the toolbar titles (thread and PaneHeader) use it. Loaded by expo-font in the root layout.
 */
export const HEADER_FONT = "Bricolage Grotesque";
/** Defined in lib/web-css.ts, which must not import this file: the require below is a font asset. */
const HEADER_FALLBACK = "Bricolage Grotesque Fallback";

export const HEADER_FONT_SOURCE = require("../../assets/fonts/BricolageGrotesque-SemiBold.ttf") as number;

/**
 * The face carries its own weight; a fontWeight here would synthesize bold on web. On web a cold
 * load can paint before the face registers, so the fallback is a local alias of system-ui at 600,
 * whose advance widths match Bricolage's within 0.6 px on the tab and title words (measured), and
 * the lens tabs do not move when the real face swaps in.
 */
export const headerFace: TextStyle = { fontFamily: Platform.OS === "web" ? `"${HEADER_FONT}", "${HEADER_FALLBACK}"` : HEADER_FONT };

/** The title in the bar on top of the thread and every pane beside it, so the bars read as one toolbar. */
export const toolbarTitle: TextStyle = { ...headerFace, fontSize: 15.5, letterSpacing: -0.15 };
