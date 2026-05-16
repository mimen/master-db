import { useAuthActions } from "@convex-dev/auth/react"

import { Button } from "@/components/ui/button"

export function SignInScreen() {
  const { signIn } = useAuthActions()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            master-db
          </h1>
          <p className="text-sm text-muted-foreground">
            Personal data hub. Sign in with the owner account to continue.
          </p>
        </div>
        <Button
          className="w-full"
          onClick={() => {
            void signIn("google")
          }}
        >
          Sign in with Google
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Restricted to a single account. Other Google identities will be
          rejected.
        </p>
      </div>
    </div>
  )
}
