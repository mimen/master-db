import { afterEach, describe, expect, test } from "bun:test";
import { matchBinding, setListMode, type KeyStroke } from "./controller";
import { formatCombo, helpEntries } from "./registry";

function stroke(partial: Partial<KeyStroke> & { key: string }): KeyStroke {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...partial };
}

afterEach(() => setListMode(false));

describe("global chords", () => {
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
  test("single keys are inert outside glide mode — composer-safe", () => {
    for (const key of ["j", "k", "e", "u", "c", "z", "/", "Enter", "arrowdown"]) {
      expect(matchBinding(stroke({ key }))).toBeNull();
    }
  });

  test("glide mode activates the single-key set", () => {
    setListMode(true);
    expect(matchBinding(stroke({ key: "j" }))?.commandId).toBe("conversation.next");
    expect(matchBinding(stroke({ key: "arrowdown" }))?.commandId).toBe("conversation.next");
    expect(matchBinding(stroke({ key: "k" }))?.commandId).toBe("conversation.previous");
    expect(matchBinding(stroke({ key: "arrowup" }))?.commandId).toBe("conversation.previous");
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

  test("help hides shell-only ⌘N but shows glide keys", () => {
    const entries = helpEntries();
    const next = entries.find((e) => e.title === "Next conversation");
    expect(next?.keys).toEqual(["J", "↓"]);
    const archive = entries.find((e) => e.title === "Archive / unarchive");
    expect(archive?.keys).toEqual(["E"]);
    const nw = entries.find((e) => e.title === "New message");
    expect(nw?.keys).toEqual(["C"]);
  });
});
