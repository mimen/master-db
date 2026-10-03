import { ConvexProviderWithAuth } from "convex/react";
import { useCallback, type PropsWithChildren } from "react";
import { BASE_URL } from "./config";
import { fetchAccessToken } from "./convex-token";
import { convexClient } from "./identity";

export { useConvexAuth } from "convex/react";

function useTailnetAuth() {
  const token = useCallback(
    (options: { forceRefreshToken: boolean }) => fetchAccessToken(BASE_URL, options),
    [],
  );
  return { isLoading: false, isAuthenticated: true, fetchAccessToken: token };
}

export function ClientAuthProvider({ children }: PropsWithChildren) {
  return (
    <ConvexProviderWithAuth client={convexClient} useAuth={useTailnetAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
