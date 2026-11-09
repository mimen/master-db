import AtIcon from "@hugeicons/core-free-icons/AtIcon";
import Mail01Icon from "@hugeicons/core-free-icons/Mail01Icon";
import MailAccount01Icon from "@hugeicons/core-free-icons/MailAccount01Icon";
import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import SlackIcon from "@hugeicons/core-free-icons/SlackIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native";
import { tiebreakLabel, type HandleTiebreak } from "@shared/address";
import { sourceLabel, type PlatformBadge } from "@shared/platform-profile";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

const GLYPHS: Record<Exclude<PlatformBadge["glyph"], "dot">, IconSvgElement> = {
  bubble: Message01Icon,
  slack: SlackIcon,
  mail: Mail01Icon,
};

/**
 * Where a conversation comes from, drawn as a glyph in its service's colour: a blue or green bubble, Slack's mark, or an
 * envelope, with a person on it for the personal mailbox. `decorative` when the word is already spoken beside it.
 */
export function SourceIcon({ badge, personal = false, size = 13, decorative = false }: {
  readonly badge: PlatformBadge;
  readonly personal?: boolean;
  readonly size?: number;
  readonly decorative?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  if (badge.glyph === "dot") return <ServiceDot badge={badge} />;
  const icon = badge.glyph === "mail" && personal ? MailAccount01Icon : GLYPHS[badge.glyph];
  return (
    <View
      {...(decorative ? { "aria-hidden": true } : { role: "img" as const, "aria-label": sourceLabel(badge, personal) })}
      style={styles.glyph}
    >
      <HugeiconsIcon icon={icon} size={size} color={theme[badge.color]} strokeWidth={1.8} />
    </View>
  );
}

/** The kind of handle that separates two rows of one name on one service: a phone, or an email address. */
export function HandleIcon({ tiebreak, size = 12, decorative = false }: {
  readonly tiebreak: HandleTiebreak;
  readonly size?: number;
  readonly decorative?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      {...(decorative ? { "aria-hidden": true } : { role: "img" as const, "aria-label": tiebreakLabel(tiebreak) })}
      style={styles.glyph}
    >
      <HugeiconsIcon icon={tiebreak.kind === "phone" ? SmartPhone01Icon : AtIcon} size={size} color={theme.textSecondary} strokeWidth={1.8} />
    </View>
  );
}

export function ServiceDot({ badge, size = 7 }: { readonly badge: PlatformBadge; readonly size?: number }): React.JSX.Element {
  const theme = useTheme();
  return <View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme[badge.color] }]} />;
}

const styles = StyleSheet.create({
  glyph: { flexShrink: 0 },
  dot: { flexShrink: 0 },
});
