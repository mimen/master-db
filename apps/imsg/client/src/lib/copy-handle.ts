import { formatAddress } from "@shared/address";
import * as Clipboard from "expo-clipboard";

import { showToast } from "@/lib/toast";

/** The menu entry that copies a phone number or email, as the app shows it. `whose` names the person in a group. */
export function copyHandleAction(address: string, whose?: string): { label: string; onPress: () => void } {
  const shown = formatAddress(address);
  const email = shown.includes("@");
  return {
    label: whose ? `Copy ${whose}'s ${email ? "email" : "number"}` : `Copy ${email ? "email" : "phone number"}`,
    onPress: () => void Clipboard.setStringAsync(shown).then(() => showToast(`Copied ${shown}`)),
  };
}
