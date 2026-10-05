import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { EmptyState } from "@/components/empty-state";
import { BlurSwap } from "@/components/motion/blur-swap";
import { Collapse } from "@/components/motion/collapse";
import { LiquidTabs } from "@/components/motion/liquid-tabs";
import { MorphSendButton, type SendStatus } from "@/components/motion/morph-send-button";
import { RollingNumber } from "@/components/motion/rolling-number";
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

/**
 * Every primitive and state on one page, for the visual fixture. Never in production.
 * `?motion=1` swaps in the motion primitives, whose send buttons would collide with the static page's.
 */
export default function UiGallery(): React.JSX.Element | null {
  const theme = useTheme();
  const { motion } = useLocalSearchParams<{ motion?: string }>();
  if (clientReleaseBuild().environment === "production") return null;
  if (motion) {
    return (
      <ScrollView testID="ui-gallery" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.page}>
        <MotionGallery />
      </ScrollView>
    );
  }
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

const LENSES = [
  { key: "needs", label: "Needs reply", count: 41 },
  { key: "unread", label: "Unread", count: 12 },
  { key: "waiting", label: "Waiting", count: 0 },
  { key: "all", label: "All", count: 0 },
] as const;
type Lens = (typeof LENSES)[number]["key"];

const ROWS = ["Ana Ruiz", "Kai Moreno", "Design crew"];

/** The motion primitives, each driven by a button, so the fixture can record them moving. */
function MotionGallery(): React.JSX.Element {
  const theme = useTheme();
  const [lens, setLens] = useState<Lens>("needs");
  const [settled, setSettled] = useState(false);
  const [count, setCount] = useState(9);
  const [gone, setGone] = useState<string[]>([]);
  const [send, setSend] = useState<SendStatus>("idle");
  const current = LENSES.find((tab) => tab.key === lens) ?? LENSES[0];

  const startSend = () => {
    setSend("sending");
    setTimeout(() => setSend("sent"), 1200);
    setTimeout(() => setSend("idle"), 1200 + 1100);
  };

  return (
    <View testID="motion-gallery" style={styles.motion}>
      <SectionLabel>Liquid tabs</SectionLabel>
      <View style={[styles.lens, { borderBottomColor: theme.divider }]}>
        <LiquidTabs
          tabs={LENSES}
          value={lens}
          onChange={setLens}
          renderLabel={(tab, color) => {
            const count = LENSES.find((l) => l.key === tab.key)?.count ?? 0;
            return (
              <Text style={[styles.tabLabel, { color }]}>
                {tab.label}
                {count > 0 && <Text style={styles.tabCount}> {count}</Text>}
              </Text>
            );
          }}
        />
      </View>
      <BlurSwap swapKey={lens} spring="smooth" style={styles.inset}>
        <Text style={{ color: theme.textSecondary }}>{current.label} lists {current.count} conversations.</Text>
      </BlurSwap>

      <SectionLabel>Blur swap</SectionLabel>
      <View style={styles.line}>
        <Button label={settled ? "Undo" : "Settle"} onPress={() => setSettled((s) => !s)} />
        <BlurSwap swapKey={settled ? "settled" : "turn"}>
          <Text style={[styles.strong, { color: settled ? theme.textSecondary : theme.text }]}>
            {settled ? "Settled" : "Your turn for 5h"}
          </Text>
        </BlurSwap>
      </View>

      <SectionLabel>Rolling number</SectionLabel>
      <View style={styles.line}>
        <Button label="−1" onPress={() => setCount((n) => Math.max(0, n - 1))} />
        <Button label="+1" onPress={() => setCount((n) => n + 1)} />
        <Button label="+37" onPress={() => setCount((n) => n + 37)} />
        <View style={[styles.badge, { backgroundColor: theme.accent }]}>
          <RollingNumber value={count} style={[styles.badgeText, { color: theme.onAccent }]} />
        </View>
      </View>

      <SectionLabel>Collapse</SectionLabel>
      {ROWS.map((name) => (
        <Collapse key={name} collapsed={gone.includes(name)}>
          <Row title={name} subtitle="Settle collapses this row" onPress={() => setGone((g) => [...g, name])} />
        </Collapse>
      ))}
      <View style={styles.line}>
        <Button label="Restore rows" onPress={() => setGone([])} />
      </View>

      <SectionLabel>Morph send button</SectionLabel>
      <View style={styles.line}>
        <MorphSendButton status={send} onPress={startSend} />
        <MorphSendButton status="idle" disabled onPress={noop} />
        <MorphSendButton status={send} onPress={startSend} color={theme.sms} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  motion: { gap: Space.xs },
  lens: { paddingHorizontal: Space.gutter, borderBottomWidth: StyleSheet.hairlineWidth },
  tabLabel: { fontSize: 14.5, fontWeight: "600" },
  tabCount: { fontSize: 11.5, fontWeight: "500" },
  inset: { paddingHorizontal: Space.gutter, paddingVertical: Space.md },
  strong: { fontSize: 14, fontWeight: "600" },
  badge: { borderRadius: 9, paddingHorizontal: 6, minWidth: 18, alignItems: "center" },
  badgeText: { fontSize: 12, lineHeight: 18, fontWeight: "600" },
  page: { gap: Space.xs, paddingBottom: Space.x4 },
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: Space.md, paddingHorizontal: Space.gutter },
  empty: { height: 160 },
});
