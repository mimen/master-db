import { router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/hooks/use-theme";
import { PersonContent } from "@/components/person-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { goBackOrHome } from "@/lib/back-navigation";

export default function PersonScreen(): React.JSX.Element | null {
  const { address, name } = useLocalSearchParams<{ address: string; name?: string }>();
  const { wide } = useLayoutMode();
  const colors = useTheme();
  if (wide || !address) return null;
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.thread }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        <PersonContent address={address} name={name} onBackToList={() => goBackOrHome(router)} />
      </View>
    </SafeAreaView>
  );
}
