import type { Support } from "@shared/platform-profile";

import type { SheetAction } from "@/lib/action-sheet";

/** A menu action as the conversation's route allows it: absent, greyed with the reason, or live. */
export function gated(support: Support | null, action: SheetAction): SheetAction[] {
  if (!support) return [];
  return [support.ok ? action : { ...action, disabled: true, note: support.reason, onPress: () => undefined }];
}

/** The reason a feature is greyed, or undefined when it is live or absent. */
export function reasonOf(support: Support | null): string | undefined {
  return support && !support.ok ? support.reason : undefined;
}
