import Message01Icon from "@hugeicons/core-free-icons/Message01Icon";
import UserMultipleIcon from "@hugeicons/core-free-icons/UserMultipleIcon";
import type { IconSvgElement } from "@hugeicons/react-native";

interface Workspace {
  readonly id: string;
  readonly label: string;
  readonly icon: IconSvgElement;
  readonly path: string;
  /** The phone tab screen under app/(tabs). */
  readonly tab: string;
  /** Extra palette match terms for "Go to <label>". */
  readonly keywords: readonly string[];
}

/**
 * The app's top-level workspaces, in navigation order. The desktop router, sidebar footer, phone tab bar
 * and palette all read this list. The first is home: a cold load opens it.
 */
export const WORKSPACES = [
  { id: "messages", label: "Messages", icon: Message01Icon, path: "/", tab: "index", keywords: ["tab", "inbox"] },
  { id: "contacts", label: "Contacts", icon: UserMultipleIcon, path: "/contacts", tab: "contacts", keywords: ["tab", "people"] },
] as const satisfies readonly Workspace[];

export type WorkspaceId = (typeof WORKSPACES)[number]["id"];
export type WorkspacePath = (typeof WORKSPACES)[number]["path"];

export const HOME_WORKSPACE = WORKSPACES[0];

export function isWorkspaceId(value: string): value is WorkspaceId {
  return WORKSPACES.some((workspace) => workspace.id === value);
}

export function workspacePath(id: WorkspaceId): WorkspacePath {
  return WORKSPACES.find((workspace) => workspace.id === id)?.path ?? HOME_WORKSPACE.path;
}
