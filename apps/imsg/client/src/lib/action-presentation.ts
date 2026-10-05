import type { Ionicons } from "@expo/vector-icons";

export type IconName = keyof typeof Ionicons.glyphMap;

/** The presentation fields a caller may set on a sheet action; any it leaves out are derived. */
export interface ActionPresentationInput {
  label: string;
  icon?: IconName;
  shortcut?: string;
  note?: string;
  separatorBefore?: boolean;
}

export interface ActionPresentation {
  label: string;
  icon?: IconName;
  shortcut?: string;
  note?: string;
  separatorBefore: boolean;
}

interface Preset {
  icon: IconName;
  shortcut?: string;
  /** Menu block; a separator falls wherever the block changes. */
  block: number;
}

// Keyed by label prefix so the menu dresses today's thread-view labels with no caller change.
const PRESETS: ReadonlyArray<readonly [prefix: string, preset: Preset]> = [
  ["Reply", { icon: "arrow-undo-outline", shortcut: "⌘R", block: 0 }],
  ["Copy", { icon: "copy-outline", shortcut: "⌘C", block: 0 }],
  ["Forward", { icon: "arrow-redo-outline", block: 0 }],
  ["Send again", { icon: "refresh", block: 0 }],
  ["Edit", { icon: "pencil-outline", block: 1 }],
  ["Unsend", { icon: "arrow-undo-circle-outline", block: 1 }],
  ["Undo send", { icon: "arrow-undo-circle-outline", block: 1 }],
  ["Delete", { icon: "trash-outline", shortcut: "⌫", block: 2 }],
];

const PENDING_SUFFIX = " · available once sent";
const PENDING_NOTE = "Available once it's sent";

/**
 * Derives icon, shortcut, note and separators for a menu's actions. Explicit fields always win.
 * A run of actions sharing one note shows it once, under the last of the run.
 */
export function presentActions(actions: readonly ActionPresentationInput[]): ActionPresentation[] {
  let previousBlock: number | undefined;
  const presented = actions.map((action, index) => {
    const pending = action.label.endsWith(PENDING_SUFFIX);
    const label = pending ? action.label.slice(0, -PENDING_SUFFIX.length) : action.label;
    const preset = PRESETS.find(([prefix]) => label.startsWith(prefix))?.[1];
    const block = preset?.block ?? previousBlock;
    const separatorBefore = action.separatorBefore ?? (index > 0 && block !== previousBlock);
    previousBlock = block;
    return {
      label,
      icon: action.icon ?? preset?.icon,
      shortcut: action.shortcut ?? preset?.shortcut,
      note: action.note ?? (pending ? PENDING_NOTE : undefined),
      separatorBefore,
    };
  });
  return presented.map((p, i) => {
    const next = presented[i + 1];
    return next && p.note !== undefined && next.note === p.note && !next.separatorBefore
      ? { ...p, note: undefined }
      : p;
  });
}
