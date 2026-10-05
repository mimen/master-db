import { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatAddress } from "@shared/address";
import type { ChatSummary } from "@shared/types";

import { guessFromMessage, type HandleService } from "@/lib/contact-order";
import { type ContactListRow, primaryHandle, useAddHandle, useCreatePerson, useListPeople, useWhoIs } from "@/lib/identity";
import { showToast } from "@/lib/toast";
import { PersonAvatar } from "./avatar";
import { useTheme } from "@/hooks/use-theme";
import { chatIsSMS } from "@/lib/chat-service";
import { ServiceDot } from "./contacts-theme";
import { ContactsButton, IconAction } from "./contacts-ui";

/**
 * The New contact panel: first and last name, an organization guessed from
 * the message, and the number with its service. Below a divider, the closest
 * existing contact offers Add here instead.
 */
export function ContactAddPanel({ handle, service = "iMessage", message, title = "New contact", onDone, onClose }: {
  /** Absent: the panel asks for the phone or email too. */
  readonly handle?: string;
  readonly service?: HandleService;
  /** The sender's message, for the name and organization guess. */
  readonly message?: string;
  readonly title?: string;
  readonly onDone: (personId: string | null, handle: string) => void;
  readonly onClose?: () => void;
}) {
  const colors = useTheme();
  const guess = useMemo(() => guessFromMessage(message), [message]);
  const people = useListPeople();
  const createPerson = useCreatePerson();
  const addHandle = useAddHandle();
  const [first, setFirst] = useState(guess.first ?? "");
  const [last, setLast] = useState("");
  const [organization, setOrganization] = useState(guess.organization ?? "");
  const [newHandle, setNewHandle] = useState(handle ?? "");
  const [saving, setSaving] = useState(false);
  const target = (handle ?? newHandle).trim();

  const closest = useMemo<ContactListRow | undefined>(() => {
    const name = first.trim().toLowerCase();
    if (!handle || !name) return undefined;
    return people?.find((p) => (p.first_name ?? p.display_name.split(" ")[0]).toLowerCase() === name);
  }, [people, first, handle]);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const { personId } = await createPerson({
        handle: target,
        first_name: first.trim() || undefined,
        last_name: last.trim() || undefined,
        organization: organization.trim() || undefined,
      });
      showToast(`Added ${[first.trim(), last.trim()].filter(Boolean).join(" ") || formatAddress(target)}`);
      onDone(personId, target);
    } catch {
      showToast("Couldn't add the contact. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const addToExisting = async (person: ContactListRow) => {
    try {
      await addHandle({ personId: person._id, handle: target });
      showToast(`Added ${formatAddress(target)} to ${person.display_name}`);
      onDone(person._id, target);
    } catch {
      showToast("Couldn't add the number. Try again.");
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, opts: { placeholder?: string; autoFocus?: boolean } = {}) => (
    <View style={styles.flex}>
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoFocus={opts.autoFocus}
        value={value}
        onChangeText={onChange}
        onSubmitEditing={() => void save()}
        placeholder={opts.placeholder}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          { backgroundColor: colors.field, borderColor: colors.dividerStrong, color: colors.text },
          Platform.OS === "web" && ({ outlineColor: colors.focusRing } as object),
        ]}
      />
    </View>
  );

  return (
    <View testID="contact-add-panel" style={[styles.panel, { backgroundColor: colors.popBg, borderColor: colors.dividerStrong }]}>
      <View style={[styles.head, { borderBottomColor: colors.divider }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
        {onClose ? <IconAction icon="close" label="Close" onPress={onClose} /> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.pair}>
          {field("First name", first, setFirst, { autoFocus: true })}
          {field("Last name", last, setLast, { placeholder: "Optional" })}
        </View>
        {field("Organization", organization, setOrganization, { placeholder: "Optional" })}
        {handle ? (
          <View>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{handle.includes("@") ? "Email" : "Phone"}</Text>
            <View style={[styles.input, styles.fixed, { backgroundColor: colors.field, borderColor: colors.dividerStrong }]}>
              <Text style={[styles.flex, styles.fixedText, { color: colors.text }]}>{formatAddress(handle)}</Text>
              <ServiceDot service={service} />
              <Text style={[styles.svc, { color: colors.textSecondary }]}>{service}</Text>
            </View>
          </View>
        ) : field("Phone or email", newHandle, setNewHandle)}
        {closest ? (
          <>
            <View style={styles.dividerRow}>
              <View style={[styles.rule, { backgroundColor: colors.divider }]} />
              <Text style={[styles.dividerText, { color: colors.textTertiary }]}>or add this number to someone you know</Text>
              <View style={[styles.rule, { backgroundColor: colors.divider }]} />
            </View>
            <View style={styles.suggest}>
              <PersonAvatar address={primaryHandle(closest)} name={closest.display_name} size={36} />
              <View style={styles.flex}>
                <Text style={[styles.suggestName, { color: colors.text }]}>{closest.display_name}</Text>
                <Text style={[styles.suggestWhy, { color: colors.textSecondary }]}>
                  Same first name.{closest.message_count ? ` ${closest.message_count.toLocaleString("en-US")} messages.` : ""}
                </Text>
              </View>
              <ContactsButton label="Add here" onPress={() => void addToExisting(closest)} />
            </View>
          </>
        ) : null}
      </View>
      <View style={[styles.foot, { borderTopColor: colors.divider }]}>
        {onClose ? <ContactsButton label="Cancel" tone="ghost" onPress={onClose} /> : null}
        {saving ? <ActivityIndicator /> : <ContactsButton testID="save-contact" label="Save contact" tone="primary" disabled={!target} onPress={() => void save()} />}
      </View>
    </View>
  );
}

/**
 * The thread pane's "isn't in your contacts" banner for a one-to-one chat with
 * an unknown sender. Add contact opens the prefilled panel under it.
 */
export function UnknownSenderBanner({ chat }: { readonly chat: ChatSummary }) {
  const colors = useTheme();
  const address = chat.isGroup ? null : (chat.participants[0]?.address ?? chat.guid.split(";").pop() ?? null);
  const who = useWhoIs(address);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (!address || who?.found !== false || dismissed) return null;
  const service: HandleService = chatIsSMS(chat.guid) ? "SMS" : "iMessage";
  const inbound = chat.lastMessage && !chat.lastMessage.isFromMe ? chat.lastMessage.text : undefined;
  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <View testID="unknown-sender-banner" style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.divider }]}>
        <Ionicons name="person-add-outline" size={16} color={colors.icon} />
        <Text style={[styles.bannerText, { color: colors.text }]}>
          <Text style={styles.bold}>{formatAddress(address)}</Text> isn't in your contacts.
        </Text>
        <ContactsButton label="Add contact" onPress={() => setOpen((v) => !v)} />
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setDismissed(true)} hitSlop={8}>
          <Ionicons name="close" size={14} color={colors.textTertiary} />
        </Pressable>
      </View>
      {open ? (
        <View style={styles.floating}>
          <ContactAddPanel
            handle={address}
            service={service}
            message={inbound}
            onClose={() => setOpen(false)}
            onDone={() => setOpen(false)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  panel: { borderRadius: 16, borderWidth: 1, maxWidth: 380, width: "100%", ...(Platform.OS === "web" ? { boxShadow: "0 18px 48px -12px rgba(0,0,0,0.28)" } as object : {}) },
  head: { alignItems: "center", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingLeft: 16, paddingRight: 8, paddingVertical: 8 },
  title: { fontSize: 13.5, fontWeight: "600" },
  body: { gap: 12, padding: 16 },
  pair: { flexDirection: "row", gap: 8 },
  label: { fontSize: 12, marginBottom: 5 },
  input: { borderRadius: 8, borderWidth: 1, fontSize: 13, height: 32, paddingHorizontal: 10 },
  fixed: { alignItems: "center", flexDirection: "row", gap: 5 },
  fixedText: { fontSize: 13 },
  svc: { fontSize: 12 },
  dividerRow: { alignItems: "center", flexDirection: "row", gap: 8, marginTop: 4 },
  rule: { flex: 1, height: 1 },
  dividerText: { fontSize: 12 },
  suggest: { alignItems: "center", flexDirection: "row", gap: 10 },
  suggestName: { fontSize: 13, fontWeight: "600" },
  suggestWhy: { fontSize: 12, marginTop: 1 },
  foot: { borderTopWidth: 1, flexDirection: "row", gap: 8, justifyContent: "flex-end", padding: 12 },
  overlay: { alignItems: "center", left: 0, paddingHorizontal: 16, position: "absolute", right: 0, top: 60, zIndex: 20 },
  banner: { alignItems: "center", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 10, paddingLeft: 14, paddingRight: 10, paddingVertical: 7 },
  bannerText: { fontSize: 13 },
  bold: { fontWeight: "600" },
  floating: { marginTop: 10, width: 380, maxWidth: "100%" },
});
