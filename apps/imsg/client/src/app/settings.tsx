import { SettingsContent } from "@/components/settings-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";

export default function SettingsScreen(): React.JSX.Element | null {
  const { wide } = useLayoutMode();
  if (wide) return null;
  return <SettingsContent />;
}
