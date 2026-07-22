import { describe, expect, test } from "bun:test";
import { matchBinding, type KeyStroke } from "./controller";
import { formatCombo, helpEntries } from "./registry";

function stroke(partial: Partial<KeyStroke> & { key: string }): KeyStroke {
  return { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...partial };
}

describe("matchBinding", () => {
  test("⌘K matches the palette", () => {
    expect(matchBinding(stroke({ key: "k", metaKey: true }))?.commandId).toBe("palette.open");
  });

  test("bare letters match nothing (composer-safe)", () => {
    expect(matchBinding(stroke({ key: "k" }))).toBeNull();
    expect(matchBinding(stroke({ key: "e" }))).toBeNull();
  });

  test("shift distinguishes combos: ⌘⇧E archives, ⌘E does not", () => {
    expect(matchBinding(stroke({ key: "e", metaKey: true, shiftKey: true }))?.commandId).toBe(
      "conversation.archive",
    );
    expect(matchBinding(stroke({ key: "e", metaKey: true }))).toBeNull();
  });

  test("ctrl works as mod (non-mac)", () => {
    expect(matchBinding(stroke({ key: "arrowdown", ctrlKey: true }))?.commandId).toBe(
      "conversation.next",
    );
  });

  test("alt is not mod and blocks matches", () => {
    expect(matchBinding(stroke({ key: "k", metaKey: true, altKey: true }))).toBeNull();
  });

  test("escape matches without modifiers and never preventDefaults", () => {
    const binding = matchBinding(stroke({ key: "Escape" }));
    expect(binding?.commandId).toBe("navigation.escape");
    expect(binding?.preventDefault).toBe(false);
  });

  test("navigation allows repeat; actions do not", () => {
    expect(matchBinding(stroke({ key: "arrowdown", metaKey: true }))?.allowRepeat).toBe(true);
    expect(matchBinding(stroke({ key: "e", metaKey: true, shiftKey: true }))?.allowRepeat).toBe(false);
  });
});

describe("registry", () => {
  test("formatCombo renders mac-style symbols", () => {
    expect(formatCombo("mod+shift+e")).toBe("⌘⇧E");
    expect(formatCombo("mod+arrowdown")).toBe("⌘↓");
    expect(formatCombo("escape")).toBe("Esc");
  });

  test("help hides shell-only bindings (⌘N) but keeps the rest", () => {
    const entries = helpEntries();
    const titles = entries.map((e) => e.title);
    expect(titles).not.toContain("New message");
    expect(titles).toContain("Search");
    expect(entries.find((e) => e.title === "Archive / unarchive")?.keys).toEqual(["⌘⇧E"]);
  });
});
