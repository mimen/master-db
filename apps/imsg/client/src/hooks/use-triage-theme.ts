import { useColorScheme } from "@/hooks/use-color-scheme";
import { TriageTheme, type TriageThemeValue } from "@/constants/triage-theme";

export function useTriageTheme(): TriageThemeValue {
  return TriageTheme[useColorScheme() === "dark" ? "dark" : "light"];
}
