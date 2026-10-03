import type { PropsWithChildren } from "react";

export { useConvexAuth } from "./convex.fixture";

export function ClientAuthProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}
