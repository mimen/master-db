import Ionicons from "@expo/vector-icons/Ionicons";
import Attachment01Icon from "@hugeicons/core-free-icons/Attachment01Icon";
import { HugeiconsIcon } from "@hugeicons/react-native";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OverlayShell } from "@/components/overlay-shell";
import { BackButton } from "@/components/ui/back-button";
import { IconButton } from "@/components/ui/icon-button";
import { useLayoutMode } from "@/hooks/use-layout-mode";
import { useTheme } from "@/hooks/use-theme";
import { isShown, registerEscapeCloser } from "@/lib/keyboard/controller";

/**
 * The compose sheet: the one frame for a new message, a forward and a new email, and the docked email reply. A header
 * with the title and close, the caller's rows (To chips, Cc, Subject, From) and body, then the footer. As an overlay it
 * is a centered sheet on a desktop and the whole screen inside the safe area on a phone; `screen` draws the same frame
 * as a phone route's page. Esc and close shut it while it holds nothing the user wrote, and ask before discarding when
 * it does.
 */
export function ComposeSheet({ title, header, presentation = "overlay", dirty, onClose, testID, children }: {
  /** Names the sheet; the header shows it unless `header` replaces it. */
  title: string;
  header?: ReactNode;
  presentation?: "overlay" | "screen" | "docked";
  /** Whether closing would throw away something the user wrote. */
  dirty: boolean;
  onClose: () => void;
  testID?: string;
  children: ReactNode;
}): React.JSX.Element {
  const theme = useTheme();
  const { wide } = useLayoutMode();
  const insets = useSafeAreaInsets();
  const [confirming, setConfirming] = useState(false);
  const frame = useRef<View>(null);
  const live = useRef({ dirty, confirming, onClose });
  live.current = { dirty, confirming, onClose };
  const request = (): void => {
    const now = live.current;
    if (!now.dirty) now.onClose();
    else setConfirming(!now.confirming);
  };
  const requestRef = useRef(request);
  requestRef.current = request;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (presentation === "overlay") {
      // The Modal answers Esc on keyup; the keydown must not reach the shell, which would close a route overlay unasked.
      const swallow = (event: KeyboardEvent): void => {
        if (event.key === "Escape") event.stopPropagation();
      };
      window.addEventListener("keydown", swallow, true);
      return () => window.removeEventListener("keydown", swallow, true);
    }
    return registerEscapeCloser(() => {
      if (!isShown(frame.current)) return false;
      requestRef.current();
      return true;
    });
  }, [presentation]);

  const phone = !wide && presentation !== "docked";
  const close = phone ? <BackButton onPress={request} label={`Close ${title}`} /> : (
    <IconButton label={`Close ${title}`} onPress={request}>
      {({ active }) => <Ionicons name="close" size={18} color={active ? theme.text : theme.icon} />}
    </IconButton>
  );
  const top = confirming ? (
    <View style={[styles.header, presentation === "docked" && styles.dockedHeader]}>
      <Text accessibilityRole="alert" style={[styles.title, styles.fill, { color: theme.text }]}>Discard what you wrote?</Text>
      <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} style={({ hovered }) => [styles.textButton, hovered && { backgroundColor: theme.rowHover }]}>
        <Text style={[styles.textButtonLabel, { color: theme.text }]}>Keep editing</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onClose} style={({ hovered }) => [styles.textButton, hovered && { backgroundColor: theme.rowHover }]}>
        <Text style={[styles.textButtonLabel, { color: theme.destructive }]}>Discard</Text>
      </Pressable>
    </View>
  ) : (
    <View style={[styles.header, presentation === "docked" && styles.dockedHeader]}>
      {phone ? close : null}
      <View style={styles.fill}>
        {header ?? <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: theme.text }]}>{title}</Text>}
      </View>
      {phone ? null : close}
    </View>
  );

  if (presentation === "docked") {
    return (
      <View ref={frame} testID={testID} style={[styles.docked, { backgroundColor: theme.surface, borderColor: theme.divider }]}>
        {top}
        {children}
      </View>
    );
  }
  const body = (
    <KeyboardAvoidingView
      ref={frame as never}
      testID={testID}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.fill, { backgroundColor: theme.background }, phone && { paddingBottom: insets.bottom, paddingTop: insets.top }]}
    >
      <View style={[styles.sheetHeader, { borderBottomColor: theme.divider }]}>{top}</View>
      {children}
    </KeyboardAvoidingView>
  );
  if (presentation === "screen") return body;
  return (
    <OverlayShell
      visible
      onClose={request}
      accessibilityLabel={title}
      animationType={wide ? "fade" : "slide"}
      backdropStyle={wide ? styles.backdrop : styles.phoneBackdrop}
      cardStyle={wide ? styles.card : styles.fill}
    >
      {body}
    </OverlayShell>
  );
}

/** A labeled row of the sheet: To, Cc, Subject, From. */
export function SheetField({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.field, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.label, { color: theme.textTertiary }]}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

/** To or Cc: a chip per recipient, each removable, then the field that adds more. Backspace in an empty field drops the last chip. */
export function ChipField({ label, chips, onRemove, input }: {
  label: "To" | "Cc";
  chips: readonly { key: string; label: string }[];
  onRemove: (key: string) => void;
  input: TextInputProps & { ref?: Ref<TextInput> };
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <SheetField label={label}>
      {chips.map((chip) => (
        <Pressable
          key={chip.key}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${chip.label} from ${label}`}
          onPress={() => onRemove(chip.key)}
          style={({ hovered }) => [styles.chip, { backgroundColor: hovered ? theme.rowSelected : theme.rowHover, borderColor: theme.divider }]}
        >
          <Text testID="recipient-chip" numberOfLines={1} style={[styles.chipText, { color: theme.text }]}>{chip.label}</Text>
          <Ionicons name="close" size={12} color={theme.textTertiary} />
        </Pressable>
      ))}
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.textTertiary}
        {...input}
        onKeyPress={(event) => {
          const last = chips[chips.length - 1];
          if (event.nativeEvent.key === "Backspace" && !input.value && last) onRemove(last.key);
          input.onKeyPress?.(event);
        }}
        style={[styles.input, styles.chipInput, { color: theme.text }, WEB_INPUT]}
      />
    </SheetField>
  );
}

export interface Mailbox {
  _id: string;
  label: string;
  gmailApp?: "workspace" | "personal";
}

export const mailboxName = (mailbox: Mailbox): string => (mailbox.gmailApp === "personal" ? "Personal" : "AUF");

/**
 * The mailbox an email goes out from, as one chip. With `onChange` a tap switches to the next mailbox (AUF and Personal
 * are the two there are), which keeps the choice inside the sheet; a reply's is fixed.
 */
export function FromChip({ mailboxes, value, onChange }: {
  mailboxes: readonly Mailbox[];
  value: string | null;
  onChange?: (id: string) => void;
}): React.JSX.Element | null {
  const theme = useTheme();
  const at = mailboxes.findIndex((mailbox) => mailbox._id === value);
  const current = mailboxes[at];
  if (!current) return null;
  const next = mailboxes[(at + 1) % mailboxes.length]!;
  return (
    <SheetField label="From">
      <Pressable
        testID="from-chip"
        accessibilityRole={onChange ? "button" : "text"}
        accessibilityLabel={`From ${mailboxName(current)}, ${current.label}`}
        accessibilityHint={onChange ? `Switches to ${mailboxName(next)}` : undefined}
        disabled={!onChange}
        onPress={() => onChange?.(next._id)}
        style={({ hovered }) => [styles.chip, { backgroundColor: hovered && onChange ? theme.rowSelected : theme.rowHover, borderColor: theme.divider }]}
      >
        <Text style={[styles.chipText, { color: theme.text }]}>{mailboxName(current)}</Text>
        <Text numberOfLines={1} style={[styles.chipNote, { color: theme.textTertiary }]}>{current.label}</Text>
        {onChange ? <Ionicons name="swap-horizontal" size={13} color={theme.textTertiary} /> : null}
      </Pressable>
    </SheetField>
  );
}

/** Attach, a hint or the error, Send later and Send. Each control shows only where its send path can do it. */
export function SheetFooter({ onAttach, attaching, note, error, onLater, ready, sending, onSend }: {
  onAttach?: () => void;
  attaching?: boolean;
  note?: string;
  error?: string | null;
  onLater?: (event: GestureResponderEvent) => void;
  ready: boolean;
  sending: boolean;
  onSend: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.footer, { borderTopColor: theme.divider }]}>
      {onAttach ? (
        <IconButton label={attaching ? "Attaching…" : "Attach files"} onPress={onAttach}>
          {({ active }) => <HugeiconsIcon icon={Attachment01Icon} size={18} color={active ? theme.text : theme.icon} strokeWidth={1.6} />}
        </IconButton>
      ) : null}
      <Text numberOfLines={2} style={[styles.hint, { color: error ? theme.destructive : theme.textTertiary }]}>{error ?? note ?? ""}</Text>
      {onLater ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send later"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={onLater}
          style={({ hovered }) => [styles.later, { opacity: ready ? 1 : 0.45 }, hovered && ready && { backgroundColor: theme.rowHover }]}
        >
          <Ionicons name="time-outline" size={15} color={theme.icon} />
          <Text style={[styles.laterText, { color: theme.textSecondary }]}>Send later</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={onSend}
        style={({ hovered, pressed }) => [styles.send, { backgroundColor: theme.accent, opacity: ready ? (pressed ? 0.8 : hovered ? 0.9 : 1) : 0.45 }]}
      >
        <Text style={[styles.sendText, { color: theme.onAccent }]}>{sending ? "Sending…" : "Send"}</Text>
      </Pressable>
    </View>
  );
}

export const WEB_INPUT = Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null;

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  backdrop: { padding: 32 },
  phoneBackdrop: { alignItems: "stretch", justifyContent: "flex-end" },
  card: { borderRadius: 14, height: 560, maxHeight: "100%", maxWidth: "100%", overflow: "hidden", width: 640 },
  docked: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginHorizontal: 20, marginVertical: 12, overflow: "hidden" },
  sheetHeader: { borderBottomWidth: StyleSheet.hairlineWidth },
  header: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 48, paddingHorizontal: 16 },
  dockedHeader: { minHeight: 40, paddingHorizontal: 12, paddingTop: 4 },
  title: { fontSize: 15, fontWeight: "600" },
  textButton: { borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 },
  textButtonLabel: { fontSize: 13, fontWeight: "600" },
  field: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 8, minHeight: 42, paddingHorizontal: 16, paddingVertical: 6 },
  label: { fontSize: 13, width: 52 },
  chips: { alignItems: "center", flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6, minWidth: 0 },
  chip: { alignItems: "center", borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 6, maxWidth: 280, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: "500" },
  chipNote: { flexShrink: 1, fontSize: 12 },
  input: { flex: 1, fontSize: 14, paddingVertical: 2 },
  chipInput: { minWidth: 80 },
  footer: { alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8 },
  hint: { flex: 1, fontSize: 12 },
  later: { alignItems: "center", borderRadius: 8, flexDirection: "row", gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  laterText: { fontSize: 13, fontWeight: "500" },
  send: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 7 },
  sendText: { fontSize: 14, fontWeight: "600" },
});
