import type { ConvexAuthActionsContext } from "@convex-dev/auth/react";
import type { PropsWithChildren } from "react";

export function ClientAuthProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
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
