import { isValidPhoneNumber } from "libphonenumber-js";

import { stripServiceSuffix } from "../../apps/imsg/shared/address";
import type { Participant } from "../../apps/imsg/shared/types";
import { normalizePhone } from "../identity/normalize";

export function conversationKey(input: {
  isGroup: boolean;
  primaryChatGuid: string;
  participants: Participant[];
}): string {
  if (!input.isGroup && input.participants.length === 1) {
    const address = stripServiceSuffix(input.participants[0].address);
    if (address.includes("@")) return `dm:${address.toLowerCase()}`;
    const phone = address.replace(/\D/g, "").length > 8 && isValidPhoneNumber(address, "US")
      ? normalizePhone(address)
      : "";
    return `dm:${phone || address.toLowerCase()}`;
  }
  if (input.isGroup) {
    const identifier = input.primaryChatGuid.match(/^[^;]+;[+-];(.+)$/)?.[1];
    if (identifier) return `g:${identifier}`;
  }
  return `chat:${input.primaryChatGuid}`;
}
