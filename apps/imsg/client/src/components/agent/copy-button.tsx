import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";

import { IconButton } from "@/components/ui/icon-button";
import { useTheme } from "@/hooks/use-theme";
import { showToast } from "@/lib/toast";

const COPIED_MS = 1_400;

/** better-ui's icon swap: both glyphs stay mounted and cross-fade with scale and blur. */
const swap = Platform.OS === "web"
  ? ({ transitionDuration: "200ms", transitionProperty: "opacity, transform, filter", transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)" } as ViewStyle)
  : null;
const shown = { opacity: 1, transform: [{ scale: 1 }], ...(Platform.OS === "web" ? { filter: "blur(0px)" } : {}) } as ViewStyle;
const gone = { opacity: 0, transform: [{ scale: 0.25 }], ...(Platform.OS === "web" ? { filter: "blur(4px)" } : {}) } as ViewStyle;

export function CopyButton({ text, label }: { readonly text: string; readonly label: string }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      onPress={() => {
        Clipboard.setStringAsync(text).then(() => setCopied(true), () => showToast("Couldn't copy. Try again."));
      }}
    >
      {({ active }) => (
        <View style={styles.glyphs}>
          <View style={[styles.glyph, swap, copied ? gone : shown]}>
            <Ionicons name="copy-outline" size={14} color={active ? theme.text : theme.icon} />
          </View>
          <View style={[styles.glyph, swap, copied ? shown : gone]}>
            <Ionicons name="checkmark" size={15} color={theme.success} />
          </View>
        </View>
      )}
    </IconButton>
  );
}

const styles = StyleSheet.create({
  glyphs: { height: 16, width: 16 },
  glyph: { alignItems: "center", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
});
