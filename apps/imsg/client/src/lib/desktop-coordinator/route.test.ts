import { describe, expect, test } from "bun:test";

import {
  desktopSurfaceCloseTarget,
  projectDesktopRoute,
  workspacePath,
} from "./route";
import type { DesktopRouteProjection, Result, DesktopRouteError } from "./types";

function projected(
  result: Result<DesktopRouteProjection, DesktopRouteError>,
): DesktopRouteProjection {
  if (!result.ok) throw new Error(`Projection failed: ${result.error.kind}`);
  return result.value;
}

describe("projectDesktopRoute", () => {
  test("projects primary workspace paths without clearing retained selection semantics", () => {
    expect(projected(projectDesktopRoute("/"))).toEqual({
      kind: "workspace",
      pathname: "/",
      workspace: "messages",
      workspaceProvenance: { kind: "path" },
    });
    expect(projected(projectDesktopRoute("/(tabs)/contacts/"))).toEqual({
      kind: "workspace",
      pathname: "/contacts",
      workspace: "contacts",
      workspaceProvenance: { kind: "path" },
    });
  });

  test("projects parameterized and concrete chat routes with normalized selection", () => {
    expect(
      projected(
        projectDesktopRoute("/chat/[guid]", {
          guid: "iMessage;-;+15551234567",
          name: "Ada",
          isGroup: "0",
          count: "1",
          targetGuid: "message-1",
          targetDate: "1720000000000",
        }),
      ),
    ).toEqual({
      kind: "chat",
      pathname: "/chat/[guid]",
      workspace: "messages",
      workspaceProvenance: { kind: "path" },
      selection: {
        guid: "iMessage;-;+15551234567",
        name: "Ada",
        isGroup: false,
        participantCount: 1,
        jumpTarget: { guid: "message-1", dateCreated: 1720000000000 },
        intent: "reply",
      },
    });

    const concrete = projected(projectDesktopRoute("/chat/iMessage%3B-%3B%2B1555"));
    expect(concrete.kind).toBe("chat");
    if (concrete.kind === "chat") {
      expect(concrete.selection.guid).toBe("iMessage%3B-%3B%2B1555");
    }
  });

  test("defaults person routes to Contacts and honors Messages provenance", () => {
    expect(projected(projectDesktopRoute("/person", { address: "+1555", name: "Ada" }))).toEqual({
      kind: "person",
      pathname: "/person",
      workspace: "contacts",
      workspaceProvenance: { kind: "default" },
      selection: { address: "+1555", name: "Ada" },
    });

    expect(
      projected(
        projectDesktopRoute("/person", {
          address: "+1555",
          name: "Ada",
          workspace: "messages",
          backGuid: "chat-1",
        }),
      ),
    ).toEqual({
      kind: "utility",
      pathname: "/person",
      workspace: "messages",
      workspaceProvenance: { kind: "parameter" },
      utility: {
        kind: "person",
        workspace: "messages",
        target: { address: "+1555", name: "Ada" },
        backGuid: "chat-1",
      },
    });
  });

  test("projects chat info as one selection-and-utility commit", () => {
    expect(
      projected(projectDesktopRoute("/chat-info", { guid: "chat-1", name: "Ada" })),
    ).toEqual({
      kind: "utility",
      pathname: "/chat-info",
      workspace: "messages",
      workspaceProvenance: { kind: "path" },
      utility: { kind: "chat-info", workspace: "messages", guid: "chat-1" },
      chatSelection: { guid: "chat-1", name: "Ada", intent: "reply" },
    });
  });

  test("inherits route-surface workspace in-app and defaults cold loads to Messages", () => {
    const inherited = projected(projectDesktopRoute("/scheduled", {}, "contacts"));
    expect(inherited).toEqual({
      kind: "utility",
      pathname: "/scheduled",
      workspace: "contacts",
      workspaceProvenance: { kind: "previous" },
      utility: { kind: "scheduled", workspace: "contacts" },
    });

    const cold = projected(projectDesktopRoute("/settings"));
    expect(cold.workspace).toBe("messages");
    expect(cold.workspaceProvenance).toEqual({ kind: "default" });

    const explicit = projected(
      projectDesktopRoute("/settings", { workspace: ["contacts", "messages"] }, "messages"),
    );
    expect(explicit.workspace).toBe("contacts");
    expect(explicit.workspaceProvenance).toEqual({ kind: "parameter" });
  });

  test("normalizes search, new-chat, and forward overlays", () => {
    expect(
      projected(
        projectDesktopRoute(
          "/search",
          { query: ["invoice", "ignored"], chat: "chat-1", name: "Ada" },
          "contacts",
        ),
      ),
    ).toEqual({
      kind: "route-overlay",
      pathname: "/search",
      workspace: "contacts",
      workspaceProvenance: { kind: "previous" },
      overlay: {
        kind: "search",
        query: "invoice",
        chatGuid: "chat-1",
        chatName: "Ada",
      },
    });

    const newChat = projected(
      projectDesktopRoute("/new-chat", { address: "+1555", name: "Ada" }),
    );
    expect(newChat.kind).toBe("route-overlay");
    if (newChat.kind === "route-overlay") {
      expect(newChat.overlay).toEqual({
        kind: "new-chat",
        initialContact: { address: "+1555", name: "Ada" },
      });
    }

    expect(projected(projectDesktopRoute("/forward"))).toEqual({
      kind: "route-overlay",
      pathname: "/forward",
      workspace: "messages",
      workspaceProvenance: { kind: "default" },
      overlay: { kind: "forward" },
    });
  });

  test("returns typed errors for unsupported routes and invalid required parameters", () => {
    expect(projectDesktopRoute("/person", {})).toEqual({
      ok: false,
      error: { kind: "missing-parameter", pathname: "/person", parameter: "address" },
    });
    expect(projectDesktopRoute("/chat-info", {})).toEqual({
      ok: false,
      error: { kind: "missing-parameter", pathname: "/chat-info", parameter: "guid" },
    });
    expect(projectDesktopRoute("/settings", { workspace: "calendar" })).toEqual({
      ok: false,
      error: {
        kind: "invalid-parameter",
        pathname: "/settings",
        parameter: "workspace",
        value: "calendar",
      },
    });
    expect(projectDesktopRoute("/chat/chat-1", { count: "many" })).toEqual({
      ok: false,
      error: {
        kind: "invalid-parameter",
        pathname: "/chat/chat-1",
        parameter: "count",
        value: "many",
      },
    });
    expect(projectDesktopRoute("/unknown")).toEqual({
      ok: false,
      error: { kind: "unsupported-route", pathname: "/unknown" },
    });
  });
});

describe("workspace route helpers", () => {
  test("maps workspaces and route surfaces to deterministic close targets", () => {
    expect(workspacePath("messages")).toBe("/");
    expect(workspacePath("contacts")).toBe("/contacts");
    expect(
      desktopSurfaceCloseTarget(
        projected(projectDesktopRoute("/scheduled", { workspace: "contacts" })),
      ),
    ).toBe("/contacts");
  });
});
