import AtIcon from "@hugeicons/core-free-icons/AtIcon";
import SmartPhone01Icon from "@hugeicons/core-free-icons/SmartPhone01Icon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { tiebreakLabel, type HandleTiebreak } from "@shared/address";
import { sourceLabel, type PlatformBadge } from "@shared/platform-profile";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "@/hooks/use-theme";

/** Slack's four-colour mark. */
function SlackMark({ size }: { readonly size: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 122.8 122.8">
      <Path fill="#E01E5A" d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" />
      <Path fill="#36C5F0" d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" />
      <Path fill="#2EB67D" d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" />
      <Path fill="#ECB22E" d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" />
    </Svg>
  );
}

/** Gmail's four-colour M, centred in a square. The personal mailbox adds a dot at its corner, ringed in `ring`. */
function GmailMark({ size, personal, dot, ring }: { readonly size: number; readonly personal: boolean; readonly dot: string; readonly ring: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="52 31 88 88">
      <Path fill="#4285F4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <Path fill="#34A853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <Path fill="#FBBC04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <Path fill="#EA4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <Path fill="#C5221F" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
      {personal ? <Circle cx={122} cy={103} r={20} fill={dot} stroke={ring} strokeWidth={8} /> : null}
    </Svg>
  );
}

/** A filled speech bubble, so iMessage blue and SMS green read at the brand marks' weight. */
function BubbleMark({ size, color }: { readonly size: number; readonly color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill={color} d="M12 3.5c-5.25 0-9.5 3.58-9.5 8 0 2.47 1.33 4.68 3.42 6.15-.17 1.25-.78 2.43-1.72 3.3 1.95.02 3.8-.66 5.17-1.83.84.18 1.72.28 2.63.28 5.25 0 9.5-3.58 9.5-8s-4.25-8-9.5-8z" />
    </Svg>
  );
}

/**
 * Where a conversation comes from: a blue or green bubble, Slack's mark, or Gmail's M, with a dot at its corner for the
 * personal mailbox. `decorative` when the word is already spoken beside it.
 */
export function SourceIcon({ badge, personal = false, size = 14, decorative = false }: {
  readonly badge: PlatformBadge;
  readonly personal?: boolean;
  readonly size?: number;
  readonly decorative?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  if (badge.glyph === "dot") return <ServiceDot badge={badge} />;
  return (
    <View
      {...(decorative ? { "aria-hidden": true } : { role: "img" as const, "aria-label": sourceLabel(badge, personal) })}
      style={styles.glyph}
    >
      {badge.glyph === "slack" ? <SlackMark size={size} />
        : badge.glyph === "mail" ? <GmailMark size={size} personal={personal} dot={theme.text} ring={theme.background} />
          : <BubbleMark size={size} color={theme[badge.color]} />}
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
