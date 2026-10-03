import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";
import { useEffect, type PropsWithChildren } from "react";
import { useConvexAuth } from "convex/react";
import { Platform } from "react-native";

import { isDesktopShell } from "./desktop-shell";
import { convexClient } from "./identity";
import { setConvexAuthenticated } from "./settings";

export { useAuthActions } from "@convex-dev/auth/react";
export { useConvexAuth } from "convex/react";

const nativeStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

function AuthState({ children }: PropsWithChildren) {
  const { isAuthenticated } = useConvexAuth();
  useEffect(() => {
    setConvexAuthenticated(isAuthenticated);
    return () => setConvexAuthenticated(false);
  }, [isAuthenticated]);
  return <>{children}</>;
}

export function ClientAuthProvider({ children }: PropsWithChildren) {
  return (
    <ConvexAuthProvider
      client={convexClient}
      storage={Platform.OS === "web" ? undefined : nativeStorage}
      shouldHandleCode={Platform.OS === "web" && !isDesktopShell()}
    >
      <AuthState>{children}</AuthState>
    </ConvexAuthProvider>
  );
}
