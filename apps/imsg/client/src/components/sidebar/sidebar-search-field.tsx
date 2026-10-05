import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";

import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { useType } from "@/hooks/use-type";

export interface SidebarSearchFieldProps {
  readonly value: string;
  readonly accessibilityLabel: string;
  readonly inputRef?: React.Ref<TextInput>;
  readonly onChangeText: (value: string) => void;
  readonly onClear: () => void;
  readonly returnKeyType?: TextInputProps["returnKeyType"];
  /** Wide only: the shortcut drawn at the field's trailing edge while it is empty. */
  readonly shortcut?: string;
  readonly placeholder?: string;
}

/**
 * Presentation-only search field shared by the Messages and Contacts
 * sidebars — one visual source of truth so the panes can't drift. All
 * behavior (lens wipes, debounce, clearing semantics) stays with the caller.
 */
export function SidebarSearchField({
  value,
  accessibilityLabel,
  inputRef,
  onChangeText,
  onClear,
  returnKeyType = "search",
  shortcut,
  placeholder = "Search",
}: SidebarSearchFieldProps): React.JSX.Element {
  const theme = useTheme();
  const type = useType();
  const { wide } = useLayoutMode();
  const [clearHovered, setClearHovered] = useState(false);
  return (
    <View
      style={[
        styles.field,
        { backgroundColor: theme.field, height: wide ? 30 : 40, borderRadius: wide ? 8 : 10, gap: wide ? 7 : 8, paddingLeft: wide ? 9 : 12 },
      ]}
    >
      <Ionicons name="search" size={wide ? 14 : 17} color={theme.textTertiary} />
      <TextInput
        ref={inputRef}
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        returnKeyType={returnKeyType}
        // Explicitly OFF. iOS renders a native clear button for this, which
        // web ignores — so on device you got two ✕ side by side. Worse, the
        // native one only fires onChangeText(""), bypassing onClear() and the
        // search-session reset that hangs off it, leaving state stale. The
        // custom button below is the one control on every platform.
        clearButtonMode="never"
        style={[styles.input, { color: theme.text, fontSize: type.body }]}
      />
      {shortcut && wide && value.length === 0 ? (
        <Text aria-hidden style={[styles.shortcut, { color: theme.textTertiary }]}>{shortcut}</Text>
      ) : null}
      {value.trim().length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={onClear}
          hitSlop={8}
          onHoverIn={() => setClearHovered(true)}
          onHoverOut={() => setClearHovered(false)}
        >
          <Ionicons name="close-circle" size={17} color={clearHovered ? theme.text : theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    paddingRight: 8,
  },
  shortcut: { fontSize: 11, fontVariant: ["tabular-nums"], marginRight: 2 },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
});
