import type { JumpTarget } from "@/hooks/use-messages";
import type { ChatSummary, StateFilter, TypeFilter } from "@shared/types";

export type Result<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };

export type DesktopWorkspaceId = "messages" | "contacts";

export type DesktopWorkspaceProvenance =
  | { readonly kind: "path" }
  | { readonly kind: "parameter" }
  | { readonly kind: "previous" }
  | { readonly kind: "default" };

export type SelectionIntent = "reply" | "preview";

export interface DesktopChatSelection {
  readonly guid: string;
  readonly name?: string;
  readonly isGroup?: boolean;
  readonly participantCount?: number;
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
      readonly guid: string;
    }
  | {
      readonly kind: "person";
      readonly workspace: DesktopWorkspaceId;
      readonly target: DesktopPersonSelection;
      readonly backGuid?: string;
    }
  | {
      readonly kind: "scheduled";
      readonly workspace: DesktopWorkspaceId;
    }
  | {
      readonly kind: "settings";
      readonly workspace: DesktopWorkspaceId;
    };

export type DesktopRouteOverlay =
  | {
      readonly kind: "search";
      readonly query: string;
      readonly chatGuid?: string;
      readonly chatName?: string;
    }
  | {
      readonly kind: "new-chat";
      readonly initialContact?: DesktopPersonSelection;
    }
  | { readonly kind: "forward" };

export type DesktopTransientOverlay =
  | { readonly kind: "command-palette"; readonly compose: boolean }
  | { readonly kind: "keyboard-help" }
  | {
      readonly kind: "sweep";
      readonly chats: readonly ChatSummary[];
      readonly startGuid?: string;
    };

interface DesktopRouteBase {
  readonly pathname: string;
  readonly workspace: DesktopWorkspaceId;
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
  readonly guid?: string | readonly string[];
  readonly name?: string | readonly string[];
  readonly isGroup?: string | readonly string[];
  readonly count?: string | readonly string[];
  readonly targetGuid?: string | readonly string[];
  readonly targetDate?: string | readonly string[];
  readonly address?: string | readonly string[];
  readonly personId?: string | readonly string[];
  readonly workspace?: string | readonly string[];
  readonly backGuid?: string | readonly string[];
  readonly query?: string | readonly string[];
  readonly chat?: string | readonly string[];
}

export type DesktopRouteError =
  | {
      readonly kind: "unsupported-route";
      readonly pathname: string;
    }
  | {
      readonly kind: "missing-parameter";
      readonly pathname: string;
      readonly parameter: "guid" | "address";
    }
  | {
      readonly kind: "invalid-parameter";
      readonly pathname: string;
      readonly parameter: "workspace" | "count" | "targetDate";
      readonly value: string;
    };

export interface DesktopShellState {
  readonly activeWorkspace: DesktopWorkspaceId;
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
  readonly shadow: { readonly chatGuid: string } | null;
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
  | { readonly type: "messages/chat-cleared" }
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
    }
  | {
      readonly type: "shadow/toggled";
      readonly chatGuid: string;
    }
  | { readonly type: "shadow/closed" };
