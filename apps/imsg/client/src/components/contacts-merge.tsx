import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useChatDirectory } from "@/hooks/use-chat-directory";
import { findDuplicates, handleRows, serviceIndex, type ServiceLookup } from "@/lib/contact-order";
import { type ContactListRow, primaryHandle, useListPeople, useMarkNotDuplicate, useMergePeople } from "@/lib/identity";
import { showToast } from "@/lib/toast";
import { formatAddress } from "@shared/address";
import { PersonAvatar } from "./avatar";
import { HEADER_FONT, ServiceDot, useSignal } from "./contacts-theme";
import { Card, ContactsButton, ContactsTopBar, IconAction, rowDivider, SectionHeader } from "./contacts-ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Review possible duplicates one pair at a time ("1 of 3", J and K). The Keep
 * radio picks whose name and organization win; After merging previews the
 * combined handles. Merging never deletes a message.
 */
export function ContactsMerge({ onExit, onMerged, wide }: {
  readonly onExit: () => void;
  readonly onMerged: (kept: ContactListRow) => void;
  readonly wide: boolean;
}) {
  const colors = useSignal();
  const people = useListPeople();
  const chats = useChatDirectory();
  const merge = useMergePeople();
  const markNotDuplicate = useMarkNotDuplicate();
  const pairs = useMemo(() => (people ? findDuplicates(people) : []), [people]);
  const [index, setIndex] = useState(0);
  const [keepOther, setKeepOther] = useState(false);
  const serviceOf = useMemo(() => serviceIndex(chats ?? []), [chats]);
  const at = Math.min(index, Math.max(0, pairs.length - 1));
  const pair = pairs[at];

  useEffect(() => {
    if (people && pairs.length === 0) onExit();
  }, [people, pairs.length, onExit]);

  useEffect(() => setKeepOther(false), [pair?.keep._id, pair?.other._id]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (e.key === "j") setIndex((i) => Math.min(i + 1, pairs.length - 1));
      if (e.key === "k") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pairs.length]);

  if (!pair) return <View style={[styles.fill, { backgroundColor: colors.background }]} />;
  const keep = keepOther ? pair.other : pair.keep;
  const gone = keepOther ? pair.keep : pair.other;
  const firstName = keep.first_name || keep.display_name.split(" ")[0];
  const combined = handleRows(
    {
      normalized_phones: [...keep.normalized_phones, ...gone.normalized_phones],
      normalized_emails: [...keep.normalized_emails, ...gone.normalized_emails],
      primary_handle: primaryHandle(keep) ?? undefined,
    },
    [],
    serviceOf,
  );

  const doMerge = async () => {
    try {
      await merge({ keepId: keep._id, mergeId: gone._id });
      showToast(`Merged ${keep.display_name}`);
      onMerged(keep);
    } catch {
      showToast("Couldn't merge the contacts. Try again.");
    }
  };
  const notSame = async () => {
    try {
      await markNotDuplicate({ personId: keep._id, otherId: gone._id });
    } catch {
      showToast("Couldn't save that. Try again.");
    }
  };

  const nav = (
    <>
      <IconAction icon="chevron-up" label="Previous duplicate" onPress={() => setIndex((i) => Math.max(i - 1, 0))} />
      <IconAction icon="chevron-down" label="Next duplicate" onPress={() => setIndex((i) => Math.min(i + 1, pairs.length - 1))} />
    </>
  );

  return (
    <View testID="contacts-merge" style={[styles.fill, { backgroundColor: colors.background }]}>
      {wide ? (
        <ContactsTopBar title="Possible duplicates" note={`${at + 1} of ${pairs.length}`} onCrumb={onExit} trailing={nav} />
      ) : (
        <View style={styles.phoneNav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Contacts" onPress={onExit} style={styles.back}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
            <Text style={[styles.phoneNavText, { color: colors.text }]}>Contacts</Text>
          </Pressable>
          <Text style={[styles.pos, { color: colors.textTertiary }]}>{at + 1} of {pairs.length}</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={[styles.body, !wide && styles.bodyPhone]}>
        <Text accessibilityRole="header" style={[styles.h1, { color: colors.text, fontFamily: HEADER_FONT }]}>Merge {keep.display_name}</Text>
        <Text style={[styles.lede, { color: colors.textSecondary }]}>
          Two contacts share this name. Merging keeps every handle and every conversation; nothing is deleted from Messages.
        </Text>
        <View style={[styles.cards, !wide && styles.cardsPhone]} accessibilityRole="radiogroup" accessibilityLabel="Which contact to keep">
          <MergeCard person={pair.keep} kept={!keepOther} onKeep={() => setKeepOther(false)} serviceOf={serviceOf} />
          <MergeCard person={pair.other} kept={keepOther} onKeep={() => setKeepOther(true)} serviceOf={serviceOf} />
        </View>
        <SectionHeader title="After merging" />
        <Card>
          {combined.map((row, i) => (
            <View key={row.key} style={[styles.hrow, rowDivider(colors, i === 0)]}>
              <Text style={[styles.k, { color: colors.textSecondary }]}>{row.label}</Text>
              <Text style={[styles.v, { color: colors.text }]}>{row.display}</Text>
              <ServiceDot service={row.service} />
              <Text style={[styles.svc, { color: colors.textSecondary }]}>{row.service}</Text>
              <View style={styles.stateSlot}>
                {row.primary
                  ? <Text style={[styles.prim, { backgroundColor: colors.field, color: colors.text }]}>Primary</Text>
                  : <Text style={[styles.svc, { color: colors.textSecondary }]}>Make primary</Text>}
              </View>
            </View>
          ))}
        </Card>
        <View style={[styles.foot, !wide && styles.footPhone]}>
          <Text style={[styles.footNote, { color: colors.textSecondary }]}>
            Both conversations stay separate threads and both appear on {firstName}'s page.
          </Text>
          <View style={styles.footActions}>
            <ContactsButton label="Not the same person" tone="ghost" onPress={() => void notSame()} />
            <ContactsButton testID="merge-contacts" label="Merge contacts" tone="primary" icon="git-merge-outline" onPress={() => void doMerge()} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function MergeCard({ person, kept, onKeep, serviceOf }: {
  readonly person: ContactListRow;
  readonly kept: boolean;
  readonly onKeep: () => void;
  readonly serviceOf: ServiceLookup;
}) {
  const colors = useSignal();
  const n = person.message_count ?? 0;
  const facts: Array<[string, string]> = [
    ...person.normalized_phones.map((p, i): [string, string] => [i === 0 ? "phone" : `phone ${i + 1}`, `${formatAddress(p)}, ${serviceOf(p)}`]),
    ...person.normalized_emails.map((e, i): [string, string] => [i === 0 ? "email" : `email ${i + 1}`, e]),
  ];
  if (facts.length < 2 && person.created_at) {
    const d = new Date(person.created_at);
    facts.push(["First seen", `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`]);
  }
  facts.push(["Tags", person.tags?.length ? person.tags.map((t) => t[0].toUpperCase() + t.slice(1)).join(", ") : "None"]);
  return (
    <Pressable
      role="radio"
      aria-checked={kept}
      accessibilityLabel={`Keep ${person.display_name}, ${person.organization ?? "no organization"}, ${n} messages`}
      onPress={onKeep}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: kept ? colors.text : colors.divider, borderWidth: kept ? 2 : 1 }]}
    >
      <View style={styles.cardHead}>
        <PersonAvatar address={primaryHandle(person)} name={person.display_name} size={36} />
        <View style={styles.flex}>
          <Text style={[styles.cardName, { color: colors.text }]}>{person.display_name}</Text>
          <Text style={[styles.cardSub, { color: colors.textSecondary }]}>
            {person.organization ?? "No organization"}. {n.toLocaleString("en-US")} {n === 1 ? "message" : "messages"}
          </Text>
        </View>
        <View style={styles.keep}>
          <View style={[styles.radio, { borderColor: kept ? colors.text : colors.switchOff }]}>
            {kept ? <View style={[styles.radioDot, { backgroundColor: colors.text }]} /> : null}
          </View>
          <Text style={[styles.keepText, { color: colors.text }]}>Keep</Text>
        </View>
      </View>
      {facts.map(([k, v]) => (
        <View key={k} style={[styles.fact, { borderTopColor: colors.divider }]}>
          <Text style={[styles.factK, { color: colors.textSecondary }]}>{k}</Text>
          <Text numberOfLines={1} style={[styles.factV, { color: colors.text }]}>{v}</Text>
        </View>
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  body: { alignSelf: "center", gap: 14, maxWidth: 1140, paddingHorizontal: 40, paddingVertical: 36, width: "100%" },
  bodyPhone: { paddingHorizontal: 16, paddingVertical: 12 },
  h1: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  lede: { fontSize: 13, marginBottom: 12, marginTop: -6 },
  cards: { flexDirection: "row", gap: 14, marginBottom: 14 },
  cardsPhone: { flexDirection: "column" },
  card: { borderRadius: 14, flex: 1, paddingBottom: 6, paddingHorizontal: 16, paddingTop: 14 },
  cardHead: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 10 },
  cardName: { fontSize: 14, fontWeight: "600" },
  cardSub: { fontSize: 12.5, marginTop: 1 },
  keep: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: 6 },
  radio: { alignItems: "center", borderRadius: 8, borderWidth: 1.5, height: 16, justifyContent: "center", width: 16 },
  radioDot: { borderRadius: 4, height: 8, width: 8 },
  keepText: { fontSize: 12.5, fontWeight: "600" },
  fact: { alignItems: "center", borderTopWidth: 1, flexDirection: "row", paddingVertical: 8 },
  factK: { fontSize: 12.5, width: 90 },
  factV: { flex: 1, fontSize: 13, fontVariant: ["tabular-nums"], textAlign: "right" },
  hrow: { alignItems: "center", flexDirection: "row", gap: 8, minHeight: 44, paddingHorizontal: 14 },
  k: { fontSize: 12.5, width: 110 },
  v: { flex: 1, fontSize: 13, fontVariant: ["tabular-nums"] },
  svc: { fontSize: 12 },
  stateSlot: { alignItems: "flex-end", marginLeft: 8, minWidth: 82 },
  prim: { borderRadius: 6, fontSize: 11.5, fontWeight: "600", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
  foot: { alignItems: "center", flexDirection: "row", gap: 16, marginTop: 10 },
  footPhone: { alignItems: "stretch", flexDirection: "column" },
  footNote: { flex: 1, fontSize: 12.5 },
  footActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  phoneNav: { alignItems: "center", flexDirection: "row", height: 44, justifyContent: "space-between", paddingHorizontal: 12 },
  back: { alignItems: "center", flexDirection: "row", gap: 2 },
  phoneNavText: { fontSize: 17 },
  pos: { fontSize: 13, fontVariant: ["tabular-nums"] },
});
