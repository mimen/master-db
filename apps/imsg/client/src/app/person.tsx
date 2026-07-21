import { useLocalSearchParams } from "expo-router";
import { PersonContent } from "@/components/person-content";

export default function PersonScreen() {
  const { address, name } = useLocalSearchParams<{ address: string; name?: string }>();
  if (!address) return null;
  return <PersonContent address={address} name={name} />;
}
