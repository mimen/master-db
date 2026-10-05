import { useColorScheme } from "@/hooks/use-color-scheme";

// TODO(signal-tokens): read these from the Signal tokens once U1 lands them.
const SIGNAL = {
  light: {
    turn: "#BE3A06",
    lensBar: "#EC5A1E",
    focusRing: "#E0500F",
    text: "#17171A",
    textSecondary: "#55555C",
    textTertiary: "#64646B",
    icon: "#5E5E66",
    divider: "rgba(0,0,0,0.075)",
    dividerStrong: "rgba(0,0,0,0.13)",
    surface: "#FFFFFF",
    popBg: "#FFFFFF",
    popShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 18px 48px -12px rgba(0,0,0,0.28)",
    popSelected: "rgba(0,0,0,0.075)",
    rowHover: "rgba(0,0,0,0.04)",
    chipBg: "#FFFFFF",
    chipBorder: "rgba(0,0,0,0.13)",
    switchOn: "#17171A",
    switchOff: "#8E8E95",
    onSwitch: "#FFFFFF",
    imessage: "#007AFF",
    sms: "#34C759",
    scrim: "rgba(23,23,26,0.16)",
  },
  dark: {
    turn: "#FF8A57",
    lensBar: "#FF6A2B",
    focusRing: "#FF7A40",
    text: "#EDEDEF",
    textSecondary: "#A6A6AD",
    textTertiary: "#8F8F96",
    icon: "#97979E",
    divider: "rgba(255,255,255,0.07)",
    dividerStrong: "rgba(255,255,255,0.12)",
    surface: "#1C1C1F",
    popBg: "#232326",
    popShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 18px 48px -12px rgba(0,0,0,0.75)",
    popSelected: "rgba(255,255,255,0.085)",
    rowHover: "rgba(255,255,255,0.045)",
    chipBg: "#1C1C1F",
    chipBorder: "rgba(255,255,255,0.12)",
    switchOn: "#EDEDEF",
    switchOff: "#6E6E75",
    onSwitch: "#141416",
    imessage: "#0A84FF",
    sms: "#30D158",
    scrim: "rgba(0,0,0,0.4)",
  },
} as const;

export type SignalColors = (typeof SIGNAL)["light" | "dark"];

export function useSignal(): SignalColors {
  return SIGNAL[useColorScheme() === "dark" ? "dark" : "light"];
}

// TODO(signal-motion): use springs.ts
export const SNAPPY = { duration: 220, dampingRatio: 0.9 } as const;
export const SMOOTH = { duration: 380, dampingRatio: 0.92 } as const;
export const LAZY = { duration: 550, dampingRatio: 0.96 } as const;
