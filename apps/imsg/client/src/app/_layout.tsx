import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { ConvexProvider } from "convex/react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { DesktopShellProvider } from "@/components/desktop-shell-provider";
import { ReleaseUpdateBanners } from "@/components/release-update-banners";
import { ActionSheetProvider } from "@/lib/action-sheet";
import { AppErrorBoundary } from "@/lib/app-error-boundary";
import { fetchDeployedWebRelease, installWebReleaseMonitor } from "@/lib/deploy-reload";
import { installShellReleaseBridge } from "@/lib/desktop-shell";
import { hydrateDrafts } from "@/lib/drafts";
import { convexClient } from "@/lib/identity";
import { LightboxProvider } from "@/lib/lightbox";
import { releaseStatus } from "@/lib/release-status";
import { hydrateSettings } from "@/lib/settings";
import { hydrateSidebarWidth } from "@/lib/sidebar-width";
import { ToastHost } from "@/lib/toast";
import { ensureGlobalWebCss } from "@/lib/web-css";
import { WORDMARK_FONT, WORDMARK_FONT_SOURCE } from "@/lib/wordmark-font";

ensureGlobalWebCss();

export default function RootLayout() {
  useFonts({ [WORDMARK_FONT]: WORDMARK_FONT_SOURCE });
  const colorScheme = useColorScheme();
  useEffect(() => {
    void hydrateDrafts();
    void hydrateSettings();
    void hydrateSidebarWidth();
    const stopShell = installShellReleaseBridge(releaseStatus.setShell);
    const stopWeb = typeof globalThis.document === "undefined"
      ? () => undefined
      : installWebReleaseMonitor({
          document: globalThis.document,
          fetchRelease: () => fetchDeployedWebRelease(
            (path) => fetch(path, { cache: "no-store" }),
          ),
          onRelease: releaseStatus.setDeployedWeb,
        });
    return () => {
      stopWeb();
      stopShell();
    };
  }, []);
  // A render-phase throw anywhere below (a Convex query timing out, a deploy
    // blip) must degrade to a visible fallback, not a permanently white window.
  return (
    <AppErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConvexProvider client={convexClient}>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <ActionSheetProvider>
            <LightboxProvider>
              {/* freezeOnBlur: without it the conversation list keeps
                  re-rendering on every inbound event while it sits invisible
                  behind an open thread. */}
              <DesktopShellProvider>
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
              </DesktopShellProvider>
              <ReleaseUpdateBanners />
              <ToastHost />
              <StatusBar style="auto" />
            </LightboxProvider>
          </ActionSheetProvider>
        </ThemeProvider>
      </ConvexProvider>
    </GestureHandlerRootView>
    </AppErrorBoundary>
  );
}
