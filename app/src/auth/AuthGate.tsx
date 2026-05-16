import { useConvexAuth } from "convex/react"
import type { ReactNode } from "react"

import { SignInScreen } from "./SignInScreen"

/**
 * Renders children only when the caller is authenticated. While auth is
 * still loading, renders a minimal spinner. While unauthenticated, renders
 * the sign-in screen and mounts no Convex hooks — preventing data fetches
 * from firing before the user is allowed in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <SignInScreen />
  }

  return <>{children}</>
}
