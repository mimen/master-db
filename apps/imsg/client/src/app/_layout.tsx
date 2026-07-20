import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ActionSheetProvider } from "@/lib/action-sheet";
import { LightboxProvider } from "@/lib/lightbox";
import { ToastHost } from "@/lib/toast";
import { hydrateDrafts } from "@/lib/drafts";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => {
    void hydrateDrafts();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <ActionSheetProvider>
          <LightboxProvider>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="chat/[guid]" options={{ headerBackTitle: "Messages" }} />
              <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
              <Stack.Screen name="new-chat" options={{ presentation: "modal", title: "New Message" }} />
              <Stack.Screen name="chat-info" options={{ presentation: "modal", title: "Details" }} />
              <Stack.Screen name="scheduled" options={{ presentation: "modal", title: "Scheduled" }} />
              <Stack.Screen name="forward" options={{ presentation: "modal", title: "Forward" }} />
            </Stack>
            <ToastHost />
            <StatusBar style="auto" />
          </LightboxProvider>
        </ActionSheetProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
