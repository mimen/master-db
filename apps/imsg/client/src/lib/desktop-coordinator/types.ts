import type { JumpTarget } from "@/hooks/use-messages";
import type { ConversationId, StateFilter, TypeFilter } from "@shared/types";
import type { WorkspaceId } from "@/lib/workspaces";

export type Result<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };

export type DesktopWorkspaceProvenance =
  | { readonly kind: "path" }
  | { readonly kind: "parameter" }
  | { readonly kind: "previous" }
  | { readonly kind: "default" };

export type SelectionIntent = "reply" | "preview";

export interface DesktopChatSelection {
  readonly conversationId: ConversationId;
  readonly name?: string;
  readonly isGroup?: boolean;
  readonly jumpTarget?: JumpTarget;
  readonly intent: SelectionIntent;
}

export interface DesktopPersonSelection {
  readonly address: string;
  readonly name?: string;
  readonly personId?: string;
}

export interface InboxFilters {
  readonly state: StateFilter;
  readonly type: TypeFilter;
}

export type DesktopUtility =
  | {
      readonly kind: "chat-info";
      readonly workspace: "messages";
      readonly conversationId: ConversationId;
    }
  | {
      readonly kind: "person";
      readonly workspace: WorkspaceId;
      readonly target: DesktopPersonSelection;
      /** The conversation the person pane was opened from, which its back button returns to. */
      readonly backConversation?: ConversationId;
    }
  | {
      readonly kind: "scheduled";
      readonly workspace: WorkspaceId;
    }
  | {
      readonly kind: "settings";
      readonly workspace: WorkspaceId;
    }
  /** Bound to whichever conversation is open, so it follows the selection instead of naming one. */
  | {
      readonly kind: "agent";
      readonly workspace: "messages";
    };

export type DesktopRouteOverlay =
  | {
      readonly kind: "search";
      readonly query: string;
      readonly conversationId?: ConversationId;
      readonly chatName?: string;
    }
  | {
      readonly kind: "new-chat";
      readonly initialContact?: DesktopPersonSelection;
    }
  | { readonly kind: "forward" };

export type DesktopTransientOverlay =
  | { readonly kind: "command-palette"; readonly compose: boolean }
  | { readonly kind: "keyboard-help" };

interface DesktopRouteBase {
  readonly pathname: string;
  readonly workspace: WorkspaceId;
  readonly workspaceProvenance: DesktopWorkspaceProvenance;
}

export type DesktopRouteProjection =
  | (DesktopRouteBase & { readonly kind: "workspace" })
  | (DesktopRouteBase & {
      readonly kind: "chat";
      readonly selection: DesktopChatSelection;
    })
  | (DesktopRouteBase & {
      readonly kind: "person";
      readonly workspace: "contacts";
      readonly selection: DesktopPersonSelection;
    })
  | (DesktopRouteBase & {
      readonly kind: "utility";
      readonly utility: DesktopUtility;
      readonly chatSelection?: DesktopChatSelection;
    })
  | (DesktopRouteBase & {
      readonly kind: "route-overlay";
      readonly overlay: DesktopRouteOverlay;
    });

export interface DesktopRouteParams {
  readonly conversationId?: string | readonly string[];
  readonly conversation?: string | readonly string[];
  readonly name?: string | readonly string[];
  readonly isGroup?: string | readonly string[];
  readonly targetGuid?: string | readonly string[];
  readonly targetDate?: string | readonly string[];
  readonly address?: string | readonly string[];
  readonly personId?: string | readonly string[];
  readonly workspace?: string | readonly string[];
  readonly backConversation?: string | readonly string[];
  readonly query?: string | readonly string[];
}

export type DesktopRouteError =
  | {
      readonly kind: "unsupported-route";
      readonly pathname: string;
    }
  | {
      readonly kind: "missing-parameter";
      readonly pathname: string;
      readonly parameter: "conversation" | "address";
    }
  | {
      readonly kind: "invalid-parameter";
      readonly pathname: string;
      readonly parameter: "workspace" | "targetDate";
      readonly value: string;
    };

export interface DesktopShellState {
  readonly activeWorkspace: WorkspaceId;
  readonly messages: {
    readonly filters: InboxFilters;
    readonly selection: DesktopChatSelection | null;
  };
  readonly contacts: {
    readonly selection: DesktopPersonSelection | null;
  };
  readonly utility: DesktopUtility | null;
  readonly routeOverlay: DesktopRouteOverlay | null;
  readonly transientOverlay: DesktopTransientOverlay | null;
}

export type DesktopShellAction =
  | {
      readonly type: "route/committed";
      readonly route: DesktopRouteProjection;
    }
  | {
      readonly type: "messages/filters-changed";
      readonly filters: InboxFilters;
    }
  | {
      readonly type: "messages/chat-selected";
      readonly selection: DesktopChatSelection;
    }
  | { readonly type: "messages/chat-settled" }
  | {
      readonly type: "contacts/person-selected";
      readonly selection: DesktopPersonSelection;
    }
  | {
      readonly type: "utility/toggled";
      readonly utility: DesktopUtility;
    }
  | { readonly type: "utility/closed" }
  | {
      readonly type: "route-overlay/closed";
    }
  | {
      readonly type: "overlay/opened";
      readonly overlay: DesktopTransientOverlay;
    }
  | {
      readonly type: "overlay/closed";
      readonly kind: DesktopTransientOverlay["kind"];
    };
