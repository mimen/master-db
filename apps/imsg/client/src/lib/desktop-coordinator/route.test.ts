import { describe, expect, test } from "bun:test";

import {
  desktopSurfaceCloseTarget,
  projectDesktopRoute,
} from "./route";
import { workspacePath } from "@/lib/workspaces";
import type { DesktopRouteProjection, Result, DesktopRouteError } from "./types";
import type { ConversationId } from "@shared/types";

const cid = (id: string) => id as ConversationId;

function projected(
  result: Result<DesktopRouteProjection, DesktopRouteError>,
): DesktopRouteProjection {
  if (!result.ok) throw new Error(`Projection failed: ${result.error.kind}`);
  return result.value;
}

describe("projectDesktopRoute", () => {
  test("projects the Mail workspace path, with an expo tab group prefix or not", () => {
    for (const path of ["/mail", "/(tabs)/mail/"]) {
      expect(projected(projectDesktopRoute(path))).toEqual({
        kind: "workspace", pathname: "/mail", workspace: "mail", workspaceProvenance: { kind: "path" },
      });
    }
    expect(workspacePath("mail")).toBe("/mail");
  });

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
        projectDesktopRoute("/c/[conversationId]", {
          conversationId: "conv-1",
          name: "Ada",
          isGroup: "0",
          targetGuid: "message-1",
          targetDate: "1720000000000",
        }),
      ),
    ).toEqual({
      kind: "chat",
      pathname: "/c/[conversationId]",
      workspace: "messages",
      workspaceProvenance: { kind: "path" },
      selection: {
        conversationId: cid("conv-1"),
        name: "Ada",
        isGroup: false,
        jumpTarget: { guid: "message-1", dateCreated: 1720000000000 },
        intent: "reply",
      },
    });

    const concrete = projected(projectDesktopRoute("/c/conv-2"));
    expect(concrete.kind).toBe("chat");
    if (concrete.kind === "chat") {
      expect(concrete.selection.conversationId).toBe(cid("conv-2"));
    }
  });

  test("an old /chat link shows Messages while its redirect resolves the conversation", () => {
    expect(projected(projectDesktopRoute("/chat/iMessage%3B-%3B%2B1555"))).toEqual({
      kind: "workspace",
      pathname: "/chat/iMessage%3B-%3B%2B1555",
      workspace: "messages",
      workspaceProvenance: { kind: "path" },
    });
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
          backConversation: "conv-1",
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
        backConversation: cid("conv-1"),
      },
    });
  });

  test("projects chat info as one selection-and-utility commit", () => {
    expect(
      projected(projectDesktopRoute("/chat-info", { conversation: "conv-1", name: "Ada" })),
    ).toEqual({
      kind: "utility",
      pathname: "/chat-info",
      workspace: "messages",
      workspaceProvenance: { kind: "path" },
      utility: { kind: "chat-info", workspace: "messages", conversationId: cid("conv-1") },
      chatSelection: { conversationId: cid("conv-1"), name: "Ada", intent: "reply" },
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
          { query: ["invoice", "ignored"], conversation: "conv-1", name: "Ada" },
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
        conversationId: cid("conv-1"),
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
      error: { kind: "missing-parameter", pathname: "/chat-info", parameter: "conversation" },
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
    expect(projectDesktopRoute("/c/conv-1", { targetGuid: "m1", targetDate: "soon" })).toEqual({
      ok: false,
      error: {
        kind: "invalid-parameter",
        pathname: "/c/conv-1",
        parameter: "targetDate",
        value: "soon",
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
