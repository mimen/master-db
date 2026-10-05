import { router, Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useSignal } from "@/components/contacts-theme";
import { PersonContent } from "@/components/person-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { goBackOrHome } from "@/lib/back-navigation";

export default function PersonScreen(): React.JSX.Element | null {
  const { address, name } = useLocalSearchParams<{ address: string; name?: string }>();
  const { wide } = useLayoutMode();
  const colors = useSignal();
  if (wide || !address) return null;
  return (
    <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        <PersonContent address={address} name={name} onBackToList={() => goBackOrHome(router)} />
      </View>
    </SafeAreaView>
  );
}
