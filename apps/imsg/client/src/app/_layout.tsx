import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ActionSheetProvider } from "@/lib/action-sheet";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <ActionSheetProvider>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="chat/[guid]" options={{ headerBackTitle: "Messages" }} />
            <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
            <Stack.Screen name="new-chat" options={{ presentation: "modal", title: "New Message" }} />
          </Stack>
          <StatusBar style="auto" />
        </ActionSheetProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
