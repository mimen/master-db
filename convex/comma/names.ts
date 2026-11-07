import { formatAddress } from "../../apps/imsg/shared/address";
import { nameTerms, personName, type NamedPerson } from "../identity/names";

interface StoredConversation<P extends { address: string }> {
  isGroup: boolean;
  displayName: string;
  rawDisplayName?: string;
  participants: readonly P[];
}

/**
 * Names a conversation from the identity graph at read time, so a rename shows wherever the
 * conversation does. `people[i]` is the person participant i resolves to. A group chat's own name
 * stays as the chat carries it; only rows stored before the Mini sent `rawDisplayName` fall back
 * to the stored `displayName`.
 */
export function resolveConversationNames<P extends { address: string }>(
  conversation: StoredConversation<P>,
  people: readonly (NamedPerson | null)[],
) {
  const participants = conversation.participants.map((participant, index) => ({ ...participant, name: personName(people[index]) }));
  const label = (participant: { address: string; name: string | null }) => participant.name ?? formatAddress(participant.address);
  const first = participants[0];
  const displayName = conversation.isGroup
    ? conversation.rawDisplayName === undefined ? conversation.displayName
      : conversation.rawDisplayName.trim() || participants.map(label).join(", ")
    : first ? label(first) : conversation.displayName;
  return {
    displayName,
    participants,
    known: participants.some((participant) => participant.name !== null),
    searchNames: [...new Set(people.flatMap((person) => person && personName(person) ? nameTerms(person) : []))],
  };
}
