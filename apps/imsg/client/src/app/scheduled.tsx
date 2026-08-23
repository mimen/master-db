import { ScheduledContent } from "@/components/scheduled-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";

export default function ScheduledScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return <ScheduledContent />;
}
