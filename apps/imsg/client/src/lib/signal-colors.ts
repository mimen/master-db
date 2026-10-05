import { useColorScheme } from "@/hooks/use-color-scheme";

// TODO(signal-tokens): Signal values from round4/tokens.json until U1 lands them in
// constants/tokens.ts; then read them from useTheme() and delete this file.
const SIGNAL = {
  light: {
    background: "#F4F4F5",
    surface: "#FFFFFF",
    divider: "rgba(0,0,0,0.075)",
    fieldBorder: "rgba(0,0,0,0.13)",
    popBg: "#FFFFFF",
    popShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 18px 48px -12px rgba(0,0,0,0.28)",
    popSelected: "rgba(0,0,0,0.075)",
    icon: "#5E5E66",
    tertiary: "#64646B",
    focusRing: "#E0500F",
    danger: "#C4261B",
  },
  dark: {
    background: "#0F0F11",
    surface: "#1C1C1F",
    divider: "rgba(255,255,255,0.07)",
    fieldBorder: "rgba(255,255,255,0.12)",
    popBg: "#232326",
    popShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 18px 48px -12px rgba(0,0,0,0.8)",
    popSelected: "rgba(255,255,255,0.06)",
    icon: "#97979E",
    tertiary: "#8F8F96",
    focusRing: "#FF7A40",
    danger: "#FF6B5E",
  },
} as const;

export function useSignalColors(): (typeof SIGNAL)[keyof typeof SIGNAL] {
  return SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
}
