import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { Spacing, Type } from "@/constants/theme";

export interface ListRowProps {
  /** Usually a PersonAvatar/ChatAvatar or an Ionicons glyph. Optional — some
   * rows (search results) have no leading element at all. */
  leading?: ReactNode;
  /** A string renders with the row's default title styling; pass a node for
   * custom typography (e.g. a two-part "You · Alex" header). */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Timestamp / add-button / spinner / chevron. */
  trailing?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  /** Taller touch target for surfaces with a deliberately larger row (e.g.
   * the chat-info participant list) — not exposed as a metric to unify. */
  minHeight?: number;
  /** Horizontal inset varies by surface (18/16/14) and is not part of the
   * authorized paddingVertical/avatar-size unification — pass the site's
   * existing value explicitly. Defaults to the codebase's most common 16. */
  paddingHorizontal?: number;
  titleNumberOfLines?: number;
  /** Escape hatch for per-row extras a fixed prop set can't express — a
   * divider border, for instance. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The avatar + title/subtitle + trailing-accessory pressable row shared by
 * every contact/participant/conversation list in the app. Row metrics
 * (paddingVertical 10, the 12px leading↔body gap) are the codebase's
 * dominant values, standardized here rather than left to drift per site —
 * see apps/imsg CLAUDE.md for the sweep that unified them.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  onLongPress,
  disabled,
  selected,
  minHeight,
  paddingHorizontal = Spacing.three,
  titleNumberOfLines = 1,
  style,
}: ListRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        { paddingHorizontal, minHeight },
        pressed && !selected && { backgroundColor: theme.backgroundElement },
        selected && { backgroundColor: theme.backgroundSelected },
        style,
      ]}
    >
      {leading}
      <View style={styles.body}>
        {typeof title === "string" ? (
          <Text numberOfLines={titleNumberOfLines} style={[styles.title, { color: theme.text }]}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle !== undefined &&
          (typeof subtitle === "string" ? (
            <Text numberOfLines={1} style={[styles.subtitle, { color: theme.textSecondary }]}>
              {subtitle}
            </Text>
          ) : (
            subtitle
          ))}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    // 10/12 aren't on the Spacing scale (2, 4, 8, 16, 24...) but are the
    // dominant paddingVertical/gap values measured across the app's list
    // rows — literal on purpose, not a missing token.
    gap: 12,
    paddingVertical: 10,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    fontSize: Type.body,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: Type.secondary,
  },
});
