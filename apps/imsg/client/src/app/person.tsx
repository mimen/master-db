import { useLocalSearchParams } from "expo-router";
import { PersonContent } from "@/components/person-content";
import { useLayoutMode } from "@/hooks/use-layout-mode";

export default function PersonScreen(): React.JSX.Element | null {
  const { address, name } = useLocalSearchParams<{ address: string; name?: string }>();
  const { wide } = useLayoutMode();
  if (wide || !address) return null;
  return <PersonContent address={address} name={name} />;
}
