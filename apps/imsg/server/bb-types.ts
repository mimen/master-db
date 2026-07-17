/** BlueBubbles REST wire types (subset used here), per server v1.9.x. */

export interface BBEnvelope<T> {
  status: number;
  message: string;
  data?: T;
  metadata?: { count: number; total: number; offset: number; limit: number };
  error?: unknown;
}

export interface BBHandle {
  address: string;
  country?: string;
  service?: string;
}

export interface BBAttachment {
  guid: string;
  uti?: string | null;
  mimeType?: string | null;
  transferName?: string | null;
  totalBytes?: number | null;
  isSticker?: boolean;
  hideAttachment?: boolean;
  height?: number | null;
  width?: number | null;
}

export interface BBChatProperties {
  groupPhotoGuid?: string | null;
}

export interface BBChat {
  guid: string;
  chatIdentifier?: string;
  groupId?: string;
  displayName?: string | null;
  participants?: Array<{ address: string }>;
  lastMessage?: BBMessage | null;
  properties?: BBChatProperties[];
}

export interface BBMessage {
  guid: string;
  text?: string | null;
  subject?: string | null;
  dateCreated?: number;
  dateRead?: number | null;
  dateDelivered?: number | null;
  dateEdited?: number | null;
  dateRetracted?: number | null;
  isFromMe?: boolean;
  handle?: BBHandle | null;
  attachments?: BBAttachment[];
  associatedMessageGuid?: string | null;
  associatedMessageType?: string | number | null;
  threadOriginatorGuid?: string | null;
  replyToGuid?: string | null;
  itemType?: number;
  groupActionType?: number;
  isSpam?: boolean;
  groupTitle?: string | null;
  error?: number;
  chats?: BBChat[];
}

export interface BBContact {
  phoneNumbers?: Array<{ address: string }>;
  emails?: Array<{ address: string }>;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  nickname?: string | null;
  sourceType?: string;
  /** Base64 image bytes, present when requested with extraProperties=avatar. */
  avatar?: string | null;
}

export interface BBServerInfo {
  private_api?: boolean;
  os_version?: string;
  server_version?: string;
}
