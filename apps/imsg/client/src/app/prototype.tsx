// PROTOTYPE — five inbox directions, switchable via ?variant=. Delete after choosing a winner.
import { useState } from "react";
import type { ComponentType } from "react";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/use-theme";
import { prototypeChats, prototypeMessages } from "@/prototype/data";
import { PrototypeSwitcher } from "@/prototype/switcher";
import type { PrototypeDesignProps } from "@/prototype/types";
import { QuietNative } from "@/prototype/designs/quiet-native";
import { PriorityShelf } from "@/prototype/designs/priority-shelf";
import { AdaptiveRhythm } from "@/prototype/designs/adaptive-rhythm";
import { FocusLens } from "@/prototype/designs/focus-lens";
import { TriageRail } from "@/prototype/designs/triage-rail";

interface VariantDefinition {
  key: string;
  name: string;
  component: ComponentType<PrototypeDesignProps>;
}

const variants: readonly VariantDefinition[] = [
  { key: "quiet", name: "Quiet Native", component: QuietNative },
  { key: "shelf", name: "Priority Shelf", component: PriorityShelf },
  { key: "rhythm", name: "Adaptive Rhythm", component: AdaptiveRhythm },
  { key: "lens", name: "Focus Lens", component: FocusLens },
  { key: "rail", name: "Triage Rail", component: TriageRail },
];

function normalizeVariant(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return variants.some((variant) => variant.key === candidate) ? candidate ?? variants[0].key : variants[0].key;
}

export default function PrototypeScreen(): React.JSX.Element {
  const theme = useTheme();
  const params = useLocalSearchParams<{ variant?: string | string[] }>();
  const currentKey = normalizeVariant(params.variant);
  const [selectedChatId, setSelectedChatId] = useState(prototypeChats[0].id);
  const definition = variants.find((variant) => variant.key === currentKey) ?? variants[0];
  const Variant = definition.component;

  if (!__DEV__) {
    return (
      <View style={[styles.unavailable, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: theme.textSecondary }}>Prototypes are available in development builds only.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.variantFrame}>
        <Variant
          chats={prototypeChats}
          messages={prototypeMessages}
          selectedChatId={selectedChatId}
          onSelectChat={setSelectedChatId}
        />
      </View>
      <PrototypeSwitcher
        variants={variants.map(({ key, name }) => ({ key, name }))}
        currentKey={currentKey}
        onChange={(variant) => router.setParams({ variant })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  variantFrame: {
    flex: 1,
    paddingBottom: 82,
  },
  unavailable: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
});
