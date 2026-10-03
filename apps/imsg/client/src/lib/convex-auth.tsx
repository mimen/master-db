import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import type { PropsWithChildren } from "react";
import { Platform } from "react-native";

import { isDesktopShell } from "./desktop-shell";
import { convexClient } from "./identity";

export { useAuthActions } from "@convex-dev/auth/react";
export { useConvexAuth } from "convex/react";

const nativeStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export function ClientAuthProvider({ children }: PropsWithChildren) {
  return (
    <ConvexAuthProvider
      client={convexClient}
      storage={Platform.OS === "web" ? undefined : nativeStorage}
      shouldHandleCode={Platform.OS === "web" && !isDesktopShell()}
    >
      {children}
    </ConvexAuthProvider>
  );
}
