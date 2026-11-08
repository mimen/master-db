import type { ConversationId } from "@shared/types";
import type {
  DesktopChatSelection,
  DesktopPersonSelection,
  DesktopRouteError,
  DesktopRouteParams,
  DesktopRouteProjection,
  DesktopWorkspaceProvenance,
  Result,
} from "./types";
import { HOME_WORKSPACE, isWorkspaceId, WORKSPACES, workspacePath, type WorkspaceId, type WorkspacePath } from "@/lib/workspaces";

type ProjectionResult = Result<DesktopRouteProjection, DesktopRouteError>;

function first(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split("?", 1)[0] ?? pathname;
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const withoutTabs = withLeadingSlash.replace(/^\/\(tabs\)/, "");
  if (withoutTabs === "") return "/";
  return withoutTabs.length > 1 ? withoutTabs.replace(/\/+$/, "") : withoutTabs;
}

function missing(pathname: string, parameter: "conversation" | "address"): ProjectionResult {
  return {
    ok: false,
    error: { kind: "missing-parameter", pathname, parameter },
  };
}

function invalid(
  pathname: string,
  parameter: "workspace" | "targetDate",
  value: string,
): ProjectionResult {
  return {
    ok: false,
    error: { kind: "invalid-parameter", pathname, parameter, value },
  };
}

function parseWorkspace(
  pathname: string,
  params: DesktopRouteParams,
  previousWorkspace: WorkspaceId | undefined,
): Result<
  {
    readonly workspace: WorkspaceId;
    readonly workspaceProvenance: DesktopWorkspaceProvenance;
  },
  DesktopRouteError
> {
  const raw = first(params.workspace);
  if (raw !== undefined) {
    if (!isWorkspaceId(raw)) {
      return {
        ok: false,
        error: {
          kind: "invalid-parameter",
          pathname,
          parameter: "workspace",
          value: raw,
        },
      };
    }
    return {
      ok: true,
      value: { workspace: raw, workspaceProvenance: { kind: "parameter" } },
    };
  }
  if (previousWorkspace !== undefined) {
    return {
      ok: true,
      value: {
        workspace: previousWorkspace,
        workspaceProvenance: { kind: "previous" },
      },
    };
  }
  return {
    ok: true,
    value: {
      workspace: HOME_WORKSPACE.id,
      workspaceProvenance: { kind: "default" },
    },
  };
}

function parsePerson(params: DesktopRouteParams): DesktopPersonSelection | null {
  const address = first(params.address);
  if (!address) return null;
  const name = first(params.name);
  const personId = first(params.personId);
  return {
    address,
    ...(name ? { name } : {}),
    ...(personId ? { personId } : {}),
  };
}

function parseChatSelection(
  pathname: string,
  params: DesktopRouteParams,
  pathId?: string,
): Result<DesktopChatSelection, DesktopRouteError> {
  const conversationId = (first(params.conversationId) ?? first(params.conversation) ?? pathId) as ConversationId | undefined;
  if (!conversationId) {
    return {
      ok: false,
      error: { kind: "missing-parameter", pathname, parameter: "conversation" },
    };
  }

  const targetGuid = first(params.targetGuid);
  const targetDateRaw = first(params.targetDate);
  const targetDate = targetDateRaw === undefined ? undefined : Number(targetDateRaw);
  if (targetDateRaw !== undefined && !Number.isFinite(targetDate)) {
    return {
      ok: false,
      error: {
        kind: "invalid-parameter",
        pathname,
        parameter: "targetDate",
        value: targetDateRaw,
      },
    };
  }

  const name = first(params.name);
  const isGroupRaw = first(params.isGroup);
  return {
    ok: true,
    value: {
      conversationId,
      intent: "reply",
      ...(name ? { name } : {}),
      ...(isGroupRaw === "1" ? { isGroup: true } : isGroupRaw === "0" ? { isGroup: false } : {}),
      ...(targetGuid && targetDate !== undefined
        ? { jumpTarget: { guid: targetGuid, dateCreated: targetDate } }
        : {}),
    },
  };
}

/**
 * Projects an Expo route into one atomic desktop-shell transition.
 * Route surfaces inherit the active workspace in-app and default to Messages
 * on a cold load; workspace paths and entity paths have fixed defaults.
 */
export function projectDesktopRoute(
  pathname: string,
  params: DesktopRouteParams = {},
  previousWorkspace?: WorkspaceId,
): ProjectionResult {
  const normalized = normalizePathname(pathname);

  const workspaceAtPath = WORKSPACES.find((workspace) => workspace.path === normalized);
  if (workspaceAtPath) {
    return {
      ok: true,
      value: {
        kind: "workspace",
        pathname: normalized,
        workspace: workspaceAtPath.id,
        workspaceProvenance: { kind: "path" },
      },
    };
  }

  // An old /chat/<guid> link shows Messages while app/chat/[guid].tsx resolves it to /c/<id>.
  if (/^\/chat\/.+$/.test(normalized)) {
    return {
      ok: true,
      value: {
        kind: "workspace",
        pathname: normalized,
        workspace: "messages",
        workspaceProvenance: { kind: "path" },
      },
    };
  }

  const chatPathMatch = normalized.match(/^\/c\/(.+)$/);
  if (chatPathMatch) {
    const pathId = chatPathMatch[1] === "[conversationId]" ? undefined : chatPathMatch[1];
    const selection = parseChatSelection(normalized, params, pathId);
    if (!selection.ok) return selection;
    return {
      ok: true,
      value: {
        kind: "chat",
        pathname: normalized,
        workspace: "messages",
        workspaceProvenance: { kind: "path" },
        selection: selection.value,
      },
    };
  }

  if (normalized === "/person") {
    const selection = parsePerson(params);
    if (!selection) return missing(normalized, "address");
    const rawWorkspace = first(params.workspace);
    if (rawWorkspace !== undefined && !isWorkspaceId(rawWorkspace)) {
      return invalid(normalized, "workspace", rawWorkspace);
    }
    const workspace = rawWorkspace ?? "contacts";
    const workspaceProvenance: DesktopWorkspaceProvenance = rawWorkspace
      ? { kind: "parameter" }
      : { kind: "default" };
    if (workspace === "contacts") {
      return {
        ok: true,
        value: {
          kind: "person",
          pathname: normalized,
          workspace,
          workspaceProvenance,
          selection,
        },
      };
    }
    const backConversation = first(params.backConversation) as ConversationId | undefined;
    return {
      ok: true,
      value: {
        kind: "utility",
        pathname: normalized,
        workspace,
        workspaceProvenance,
        utility: {
          kind: "person",
          workspace,
          target: selection,
          ...(backConversation ? { backConversation } : {}),
        },
      },
    };
  }

  if (normalized === "/chat-info") {
    const selection = parseChatSelection(normalized, params);
    if (!selection.ok) return selection;
    return {
      ok: true,
      value: {
        kind: "utility",
        pathname: normalized,
        workspace: "messages",
        workspaceProvenance: { kind: "path" },
        utility: {
          kind: "chat-info",
          workspace: "messages",
          conversationId: selection.value.conversationId,
        },
        chatSelection: selection.value,
      },
    };
  }

  if (normalized === "/forward") {
    return {
      ok: true,
      value: {
        kind: "route-overlay",
        pathname: normalized,
        workspace: "messages",
        workspaceProvenance: { kind: "default" },
        overlay: { kind: "forward" },
      },
    };
  }

  if (
    normalized === "/search" ||
    normalized === "/new-chat" ||
    normalized === "/scheduled" ||
    normalized === "/settings"
  ) {
    const provenance = parseWorkspace(normalized, params, previousWorkspace);
    if (!provenance.ok) return provenance;
    const { workspace, workspaceProvenance } = provenance.value;

    if (normalized === "/scheduled" || normalized === "/settings") {
      return {
        ok: true,
        value: {
          kind: "utility",
          pathname: normalized,
          workspace,
          workspaceProvenance,
          utility: {
            kind: normalized === "/scheduled" ? "scheduled" : "settings",
            workspace,
          },
        },
      };
    }

    if (normalized === "/search") {
      const query = first(params.query) ?? "";
      const conversationId = first(params.conversation) as ConversationId | undefined;
      const chatName = first(params.name);
      return {
        ok: true,
        value: {
          kind: "route-overlay",
          pathname: normalized,
          workspace,
          workspaceProvenance,
          overlay: {
            kind: "search",
            query,
            ...(conversationId ? { conversationId } : {}),
            ...(chatName ? { chatName } : {}),
          },
        },
      };
    }

    const initialContact = parsePerson(params);
    return {
      ok: true,
      value: {
        kind: "route-overlay",
        pathname: normalized,
        workspace,
        workspaceProvenance,
        overlay: {
          kind: "new-chat",
          ...(initialContact ? { initialContact } : {}),
        },
      },
    };
  }

  return {
    ok: false,
    error: { kind: "unsupported-route", pathname: normalized },
  };
}

export function desktopSurfaceCloseTarget(
  projection: DesktopRouteProjection,
): WorkspacePath {
  return workspacePath(projection.workspace);
}
