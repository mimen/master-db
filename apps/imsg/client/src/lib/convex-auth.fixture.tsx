import type { ConvexAuthActionsContext } from "@convex-dev/auth/react";
import type { PropsWithChildren } from "react";
import { ConvexProvider } from "convex/react";
import { convexClient } from "./identity.fixture";

export function ClientAuthProvider({ children }: PropsWithChildren) {
  return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}

export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: false };
}

export function useAuthActions(): ConvexAuthActionsContext {
  return {
    signIn: async () => { throw new Error("Sign-in is unavailable in fixtures"); },
    signOut: async () => undefined,
  };
}
