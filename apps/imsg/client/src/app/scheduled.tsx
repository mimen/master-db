import { useLayoutMode } from "@/hooks/use-layout-mode";
import { ScheduledContent } from "@/components/lazy-surfaces";

export default function ScheduledScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return <ScheduledContent />;
}
