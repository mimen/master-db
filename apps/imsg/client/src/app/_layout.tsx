import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConvexProvider } from "convex/react";
import { ActionSheetProvider } from "@/lib/action-sheet";
import { hydrateDrafts } from "@/lib/drafts";
import { convexClient } from "@/lib/identity";
import { LightboxProvider } from "@/lib/lightbox";
import { ToastHost } from "@/lib/toast";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => {
    void hydrateDrafts();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexProvider client={convexClient}>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <ActionSheetProvider>
            <LightboxProvider>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="chat/[guid]" options={{ headerBackTitle: "Messages" }} />
                <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
                <Stack.Screen name="new-chat" options={{ presentation: "modal", title: "New Message" }} />
                <Stack.Screen name="chat-info" options={{ presentation: "modal", title: "Details" }} />
                <Stack.Screen name="scheduled" options={{ presentation: "modal", title: "Scheduled" }} />
                <Stack.Screen name="forward" options={{ presentation: "modal", title: "Forward" }} />
                <Stack.Screen name="person" options={{ presentation: "modal", title: "Contact" }} />
              </Stack>
              <ToastHost />
              <StatusBar style="auto" />
            </LightboxProvider>
          </ActionSheetProvider>
        </ThemeProvider>
      </ConvexProvider>
    </GestureHandlerRootView>
  );
}
