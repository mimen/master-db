import { afterEach, describe, expect, test } from "bun:test";
import {
  matchBinding,
  registerFocusTarget,
  requestFocus,
  setListMode,
  type KeyStroke,
} from "./controller";
import { formatCombo, helpEntries, isCommandId } from "./registry";

function stroke(partial: Partial<KeyStroke> & { key: string }): KeyStroke {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...partial };
}

afterEach(() => setListMode(false));

describe("global chords", () => {
  test("⌘N and ⌘W are registered but hidden (native menu)", () => {
    expect(matchBinding(stroke({ key: "n", metaKey: true }))?.commandId).toBe("conversation.new");
    expect(matchBinding(stroke({ key: "w", metaKey: true }))?.commandId).toBe("navigation.close");
  });

  test("⌘K matches the palette", () => {
    expect(matchBinding(stroke({ key: "k", metaKey: true }))?.commandId).toBe("palette.open");
  });

  test("⌘I toggles details; ⌘F finds", () => {
    expect(matchBinding(stroke({ key: "i", metaKey: true }))?.commandId).toBe("conversation.details");
    expect(matchBinding(stroke({ key: "f", metaKey: true }))?.commandId).toBe("conversation.find");
  });

  test("escape matches without modifiers and never preventDefaults", () => {
    const binding = matchBinding(stroke({ key: "Escape" }));
    expect(binding?.commandId).toBe("navigation.escape");
    expect(binding?.preventDefault).toBe(false);
  });

  test("retired chords are gone: ⌘⇧E, ⌘⇧U, ⌘↑/⌘↓", () => {
    expect(matchBinding(stroke({ key: "e", metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchBinding(stroke({ key: "u", metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchBinding(stroke({ key: "arrowdown", metaKey: true }))).toBeNull();
    expect(matchBinding(stroke({ key: "arrowup", metaKey: true }))).toBeNull();
  });
});

describe("glide (list) mode", () => {
  test("nav keys (j/k/arrows) glide from ANY mode — the editable check is the only gate", () => {
    for (const key of ["j", "arrowdown"]) {
      const b = matchBinding(stroke({ key }));
      expect(b?.commandId).toBe("conversation.next");
      expect(b?.allowInEditable).toBe(false);
    }
    for (const key of ["k", "arrowup"]) {
      expect(matchBinding(stroke({ key }))?.commandId).toBe("conversation.previous");
    }
  });

  test("action keys are inert outside glide mode — composer-safe", () => {
    for (const key of ["e", "u", "c", "z", "/"]) {
      expect(matchBinding(stroke({ key }))).toBeNull();
    }
  });

  test("Enter outside glide focuses the composer, inside glide activates the row", () => {
    // The list-scope Enter must stay AHEAD of the global one in BINDINGS:
    // matchBinding returns the first match and only skips list-scope while
    // glide is off, so this pair of assertions pins the ordering.
    expect(matchBinding(stroke({ key: "Enter" }))?.commandId).toBe("composer.focus");
    setListMode(true);
    expect(matchBinding(stroke({ key: "Enter" }))?.commandId).toBe("conversation.activate");
  });

  test("composer.focus never fires while typing (fail-closed)", () => {
    expect(matchBinding(stroke({ key: "Enter" }))?.allowInEditable).toBe(false);
  });

  test("glide mode activates the single-key action set", () => {
    setListMode(true);
    expect(matchBinding(stroke({ key: "e" }))?.commandId).toBe("conversation.archive");
    expect(matchBinding(stroke({ key: "u" }))?.commandId).toBe("conversation.markUnread");
    expect(matchBinding(stroke({ key: "z" }))?.commandId).toBe("action.undo");
    expect(matchBinding(stroke({ key: "c" }))?.commandId).toBe("conversation.new");
    expect(matchBinding(stroke({ key: "/" }))?.commandId).toBe("list.focusSearch");
    expect(matchBinding(stroke({ key: "Enter" }))?.commandId).toBe("conversation.activate");
    expect(matchBinding(stroke({ key: "?", shiftKey: true }))?.commandId).toBe("help.open");
  });

  test("glide bindings are never editable-safe (fail-closed input)", () => {
    setListMode(true);
    for (const key of ["j", "e", "u", "z", "c"]) {
      expect(matchBinding(stroke({ key }))?.allowInEditable).toBe(false);
    }
  });

  test("navigation repeats; actions do not", () => {
    setListMode(true);
    expect(matchBinding(stroke({ key: "j" }))?.allowRepeat).toBe(true);
    expect(matchBinding(stroke({ key: "e" }))?.allowRepeat).toBe(false);
    expect(matchBinding(stroke({ key: "Enter" }))?.allowRepeat).toBe(false);
  });
});

describe("registry", () => {
  test("formatCombo renders mac-style symbols", () => {
    expect(formatCombo("mod+k")).toBe("⌘K");
    expect(formatCombo("arrowdown")).toBe("↓");
    expect(formatCombo("escape")).toBe("Esc");
    expect(formatCombo("shift+?")).toBe("?");
  });

  test("help hides shell-only ⌘N / ⌘W but shows glide keys", () => {
    const entries = helpEntries();
    const next = entries.find((e) => e.title === "Next conversation");
    expect(next?.keys).toEqual(["J", "↓"]);
    const archive = entries.find((e) => e.title === "Archive / unarchive");
    expect(archive?.keys).toEqual(["E"]);
    const nw = entries.find((e) => e.title === "New message");
    expect(nw?.keys).toEqual(["C"]);
    expect(entries.find((e) => e.title === "Close panel / window")).toBeUndefined();
  });

  test("isCommandId accepts registry ids only", () => {
    expect(isCommandId("conversation.new")).toBe(true);
    expect(isCommandId("navigation.close")).toBe(true);
    expect(isCommandId("not-a-command")).toBe(false);
  });
});

describe("requestFocus survives a target remount", () => {
  test("focus lands on the composer that mounts AFTER the request", async () => {
    // Reproduces the ⌘K bug: openChat requests focus while the OLD composer
    // is still registered (ThreadView is keyed by guid, so it's about to
    // unmount). The request must still land on the replacement.
    let newFocused = 0;
    const unregisterOld = registerFocusTarget("composer", () => undefined);

    requestFocus("composer");
    unregisterOld(); // old ThreadView tears down
    registerFocusTarget("composer", () => newFocused++); // replacement mounts

    await new Promise((r) => setTimeout(r, 10));
    expect(newFocused).toBe(1);
  });

  test("focuses an already-mounted target when nothing remounts", async () => {
    let focused = 0;
    registerFocusTarget("composer", () => focused++);
    requestFocus("composer");
    await new Promise((r) => setTimeout(r, 10));
    expect(focused).toBe(1);
  });
});
