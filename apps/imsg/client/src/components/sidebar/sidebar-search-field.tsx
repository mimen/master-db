import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/hooks/use-theme";

export interface SidebarSearchFieldProps {
  readonly value: string;
  readonly accessibilityLabel: string;
  /** "list-header": rides the scroll (desktop). "chrome": inline in the
   * fixed glass bar (mobile), where the bar owns the margins. */
  readonly placement: "list-header" | "chrome";
  readonly inputRef?: React.Ref<TextInput>;
  readonly onChangeText: (value: string) => void;
  readonly onClear: () => void;
  readonly returnKeyType?: TextInputProps["returnKeyType"];
}

/**
 * Presentation-only search field shared by the Messages and Contacts
 * sidebars — one visual source of truth so the panes can't drift. All
 * behavior (lens wipes, debounce, clearing semantics) stays with the caller.
 */
export function SidebarSearchField({
  value,
  accessibilityLabel,
  placement,
  inputRef,
  onChangeText,
  onClear,
  returnKeyType = "search",
}: SidebarSearchFieldProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.field,
        placement === "chrome" && styles.fieldChrome,
        { backgroundColor: theme.backgroundElement },
      ]}
    >
      <Ionicons name="search" size={17} color={theme.textSecondary} />
      <TextInput
        ref={inputRef}
        accessibilityLabel={accessibilityLabel}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search"
        placeholderTextColor={theme.textSecondary}
        returnKeyType={returnKeyType}
        clearButtonMode="while-editing"
        style={[styles.input, { color: theme.text }]}
      />
      {value.trim().length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={onClear}
          hitSlop={8}
        >
          <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: "center",
    borderRadius: 11,
    flexDirection: "row",
    gap: 8,
    height: 38,
    marginBottom: 12,
    marginHorizontal: 18,
    marginTop: 4,
    paddingHorizontal: 12,
  },
  fieldChrome: {
    flex: 1,
    marginBottom: 0,
    marginHorizontal: 0,
    marginTop: 0,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
});
