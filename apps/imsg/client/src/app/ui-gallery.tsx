import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PaneHeader } from "@/components/ui/pane-header";
import { Pill } from "@/components/ui/pill";
import { Row } from "@/components/ui/row";
import { SectionLabel } from "@/components/ui/section-label";
import { Space } from "@/constants/tokens";
import { useTheme } from "@/hooks/use-theme";
import { clientReleaseBuild } from "@/lib/release-status";

const noop = (): void => undefined;

/** Every primitive and state on one page, for the visual fixture. Never in production. */
export default function UiGallery(): React.JSX.Element | null {
  const theme = useTheme();
  if (clientReleaseBuild().environment === "production") return null;
  return (
    <ScrollView testID="ui-gallery" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page}>
      <PaneHeader
        title="Pane header"
        actions={
          <>
            <IconButton label="Search conversation" onPress={noop}>
              {({ active }) => <Ionicons name="search" size={16} color={active ? theme.text : theme.textSecondary} />}
            </IconButton>
            <IconButton label="Details" onPress={noop} disabled>
              <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
            </IconButton>
          </>
        }
      />
      <SectionLabel>Buttons</SectionLabel>
      <View style={styles.line}>
        <Button label="Send" variant="primary" onPress={noop} />
        <Button label="Cancel" onPress={noop} />
        <Button label="Delete" variant="danger" onPress={noop} />
        <Button label="Disabled" variant="primary" onPress={noop} disabled />
      </View>
      <SectionLabel>Pills</SectionLabel>
      <View style={styles.line}>
        <Pill label="Neutral" onPress={noop} />
        <Pill label="Selected" selected onPress={noop} />
        <Pill label="Accent" tone="accent" onPress={noop} />
        <Pill label="Success" tone="success" />
        <Pill label="Done" tone="success" selected />
        <Pill label="Small" size="sm" onPress={noop} />
        <Pill label="Small accent" size="sm" tone="accent" selected onPress={noop} />
      </View>
      <SectionLabel>Rows</SectionLabel>
      <Row title="Regular row" subtitle="Secondary line" onPress={noop} trailing={<Text style={{ color: theme.textTertiary }}>9:41</Text>} />
      <Row title="Selected row" subtitle="Secondary line" selected onPress={noop} />
      <Row title="Compact row" density="compact" onPress={noop} />
      <SectionLabel>Empty state</SectionLabel>
      <View style={styles.empty}>
        <EmptyState icon="chatbubbles-outline" message="No conversations" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { gap: Space.xs, paddingBottom: Space.x4 },
  line: { flexDirection: "row", flexWrap: "wrap", gap: Space.md, paddingHorizontal: Space.gutter },
  empty: { height: 160 },
});
