import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { ensureGlobalWebCss } from "@/lib/web-css";

ensureGlobalWebCss();
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ConvexProvider } from "convex/react";
import { ActionSheetProvider } from "@/lib/action-sheet";
import { hydrateDrafts } from "@/lib/drafts";
import { installDeployReloader } from "@/lib/deploy-reload";
import { hydrateSettings } from "@/lib/settings";
import { hydrateSidebarWidth } from "@/lib/sidebar-width";
import { convexClient } from "@/lib/identity";
import { LightboxProvider } from "@/lib/lightbox";
import { ToastHost } from "@/lib/toast";

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useEffect(() => {
    void hydrateDrafts();
    void hydrateSettings();
    void hydrateSidebarWidth();
    if (typeof document === "undefined" || typeof window === "undefined") return;
    return installDeployReloader({
      document,
      fetchHtml: () => fetch("/", { cache: "no-store" }).then((r) => r.text()),
      reload: () => window.location.reload(),
    });
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexProvider client={convexClient}>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <ActionSheetProvider>
            <LightboxProvider>
              {/* freezeOnBlur: without it the conversation list keeps
                  re-rendering on every inbound event while it sits invisible
                  behind an open thread. */}
              <Stack screenOptions={{ freezeOnBlur: true }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                {/* Chevron only. A headerBackTitle ("Messages") renders INSIDE
                    the circular glass back button on iOS 26 and gets clipped
                    to "lessag" — the native "shrink the label when it doesn't
                    fit" behaviour assumes a capsule that can grow, which the
                    circle can't. "minimal" is the supported way to ask for
                    just the chevron (React Navigation 7 replaced
                    headerBackTitleVisible with this). */}
                <Stack.Screen
                  name="chat/[guid]"
                  options={{ headerBackButtonDisplayMode: "minimal" }}
                />
                <Stack.Screen name="search" options={{ presentation: "modal", title: "Search" }} />
                <Stack.Screen name="new-chat" options={{ presentation: "modal", title: "New Message" }} />
                <Stack.Screen name="chat-info" options={{ presentation: "modal", title: "Details" }} />
                <Stack.Screen name="scheduled" options={{ presentation: "modal", title: "Scheduled" }} />
                <Stack.Screen name="forward" options={{ presentation: "modal", title: "Forward" }} />
                <Stack.Screen name="person" options={{ presentation: "modal", title: "Contact" }} />
                <Stack.Screen name="settings" options={{ presentation: "modal", title: "Settings" }} />
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
