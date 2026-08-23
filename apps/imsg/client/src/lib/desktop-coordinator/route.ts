import type {
  DesktopChatSelection,
  DesktopPersonSelection,
  DesktopRouteError,
  DesktopRouteParams,
  DesktopRouteProjection,
  DesktopWorkspaceId,
  DesktopWorkspaceProvenance,
  Result,
} from "./types";

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

function missing(pathname: string, parameter: "guid" | "address"): ProjectionResult {
  return {
    ok: false,
    error: { kind: "missing-parameter", pathname, parameter },
  };
}

function invalid(
  pathname: string,
  parameter: "workspace" | "count" | "targetDate",
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
  previousWorkspace: DesktopWorkspaceId | undefined,
): Result<
  {
    readonly workspace: DesktopWorkspaceId;
    readonly workspaceProvenance: DesktopWorkspaceProvenance;
  },
  DesktopRouteError
> {
  const raw = first(params.workspace);
  if (raw !== undefined) {
    if (raw !== "messages" && raw !== "contacts") {
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
      workspace: "messages",
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
  pathGuid?: string,
): Result<DesktopChatSelection, DesktopRouteError> {
  const guid = first(params.guid) ?? pathGuid;
  if (!guid) {
    return {
      ok: false,
      error: { kind: "missing-parameter", pathname, parameter: "guid" },
    };
  }

  const countRaw = first(params.count);
  let participantCount: number | undefined;
  if (countRaw !== undefined) {
    const parsedCount = Number(countRaw);
    if (!Number.isInteger(parsedCount) || parsedCount < 0) {
      return {
        ok: false,
        error: {
          kind: "invalid-parameter",
          pathname,
          parameter: "count",
          value: countRaw,
        },
      };
    }
    participantCount = parsedCount;
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
      guid,
      intent: "reply",
      ...(name ? { name } : {}),
      ...(isGroupRaw === "1" ? { isGroup: true } : isGroupRaw === "0" ? { isGroup: false } : {}),
      ...(participantCount !== undefined ? { participantCount } : {}),
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
  previousWorkspace?: DesktopWorkspaceId,
): ProjectionResult {
  const normalized = normalizePathname(pathname);

  if (normalized === "/") {
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

  if (normalized === "/contacts") {
    return {
      ok: true,
      value: {
        kind: "workspace",
        pathname: normalized,
        workspace: "contacts",
        workspaceProvenance: { kind: "path" },
      },
    };
  }

  const chatPathMatch = normalized.match(/^\/chat\/(.+)$/);
  if (normalized === "/chat/[guid]" || chatPathMatch) {
    const pathGuid = chatPathMatch?.[1] === "[guid]" ? undefined : chatPathMatch?.[1];
    const selection = parseChatSelection(normalized, params, pathGuid);
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
    if (rawWorkspace !== undefined && rawWorkspace !== "messages" && rawWorkspace !== "contacts") {
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
    const backGuid = first(params.backGuid);
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
          ...(backGuid ? { backGuid } : {}),
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
          guid: selection.value.guid,
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
      const chatGuid = first(params.chat);
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
            ...(chatGuid ? { chatGuid } : {}),
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

export function workspacePath(workspace: DesktopWorkspaceId): "/" | "/contacts" {
  return workspace === "messages" ? "/" : "/contacts";
}

export function desktopSurfaceCloseTarget(
  projection: DesktopRouteProjection,
): "/" | "/contacts" {
  return workspacePath(projection.workspace);
}
