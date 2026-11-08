import type { JSX } from "react";

import { MailWorkspace } from "@/components/lazy-surfaces";
import { useLayoutMode } from "@/hooks/use-layout-mode";

/** Compact route adapter. On wide layouts the persistent desktop shell owns Mail and this route stays inert. */
export default function MailScreen(): JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return <MailWorkspace wide={false} />;
}
