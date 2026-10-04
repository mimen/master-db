import { useBridgeState } from "@/lib/presence-api";

export function usePrivateApi(readState = useBridgeState): boolean {
  return readState()?.privateApi ?? false;
}
