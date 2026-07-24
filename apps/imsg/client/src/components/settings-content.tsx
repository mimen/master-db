import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAiStatus } from "@/hooks/use-ai";
import { useTheme } from "@/hooks/use-theme";
import { Radii, Spacing } from "@/constants/theme";
import {
  setNameOrder,
  setSuggestionMode,
  useNameOrder,
  useSuggestionMode,
  type NameOrder,
  type SuggestionMode,
} from "@/lib/settings";
import { ListRow } from "./list-row";

export interface SettingsContentProps {
  /** Desktop pane wants its own header with a close button. */
  showHeader?: boolean;
  onClose?: () => void;
  /** When set, the header shows a back chevron with this label instead of a close X. */
  onBack?: () => void;
  backLabel?: string;
}

const NAME_ORDER_OPTIONS: ReadonlyArray<{ value: NameOrder; label: string }> = [
  { value: "first-last", label: "First Last" },
  { value: "last-first", label: "Last, First" },
];

const SUGGESTION_MODE_OPTIONS: ReadonlyArray<{ value: SuggestionMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "on-demand", label: "On demand" },
  { value: "auto", label: "Automatic" },
];

/**
 * The app's one settings surface — grouped option cards, iOS-Settings style
 * (see person-content.tsx's edit form for the same card language: persistent
 * inline labels, theme.backgroundElement cards, hairline dividers). Follows
 * the shared-content contract (showHeader/onClose/onBack) so this one
 * component serves both the mobile /settings modal and a future desktop
 * pane — same pattern as person-content.tsx / chat-info-content.tsx.
 *
 * The AI section only renders when the server reports suggestion capability
 * (useAiStatus()?.suggestions) — same gate the old sparkles button used, now
 * living here instead of at the entry point.
 */
export function SettingsContent({ showHeader = false, onClose, onBack, backLabel = "Back" }: SettingsContentProps) {
  const theme = useTheme();
  const nameOrder = useNameOrder();
  const suggestionMode = useSuggestionMode();
  const aiStatus = useAiStatus();

  const header = showHeader ? (
    <View style={[styles.paneHeader, { borderBottomColor: theme.divider }]}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel={backLabel} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={theme.accent} />
          <Text style={{ color: theme.accent, fontSize: 15 }}>{backLabel}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.paneHeaderTitle, { color: theme.text }]}>Settings</Text>
      )}
      {onClose && !onBack && (
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close settings">
          <Ionicons name="close" size={20} color={theme.textSecondary} />
        </Pressable>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {header}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>Names</Text>
          <View style={[styles.fieldGroup, { backgroundColor: theme.backgroundElement }]}>
            {NAME_ORDER_OPTIONS.map((opt, i) => (
              <ListRow
                key={opt.value}
                title={opt.label}
                titleWeight="400"
                onPress={() => setNameOrder(opt.value)}
                trailing={
                  nameOrder === opt.value ? <Ionicons name="checkmark" size={18} color={theme.accent} /> : undefined
                }
                style={
                  i < NAME_ORDER_OPTIONS.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: theme.divider,
                  }
                }
              />
            ))}
          </View>
          <Text style={[styles.fieldCaption, { color: theme.textSecondary }]}>
            Affects how names are sorted and shown in the Contacts list.
          </Text>
        </View>

        {aiStatus?.suggestions && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>AI</Text>
            <View style={[styles.fieldGroup, { backgroundColor: theme.backgroundElement }]}>
              {SUGGESTION_MODE_OPTIONS.map((opt, i) => (
                <ListRow
                  key={opt.value}
                  title={opt.label}
                  titleWeight="400"
                  onPress={() => setSuggestionMode(opt.value)}
                  trailing={
                    suggestionMode === opt.value ? (
                      <Ionicons name="checkmark" size={18} color={theme.accent} />
                    ) : undefined
                  }
                  style={
                    i < SUGGESTION_MODE_OPTIONS.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: theme.divider,
                    }
                  }
                />
              ))}
            </View>
            <Text style={[styles.fieldCaption, { color: theme.textSecondary }]}>
              How reply suggestions appear in a conversation.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 58,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  paneHeaderTitle: { fontSize: 16, fontWeight: "600" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 1, marginLeft: -4 },
  container: { padding: Spacing.three, paddingTop: Spacing.four },
  section: { width: "100%", marginBottom: Spacing.four },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginBottom: 8 },
  fieldGroup: { width: "100%", borderRadius: Radii.input, overflow: "hidden" },
  fieldCaption: { fontSize: 12, marginTop: 6, paddingHorizontal: 6 },
});
