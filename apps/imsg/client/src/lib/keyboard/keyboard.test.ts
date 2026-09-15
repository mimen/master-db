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

  test("⌘E settles, ⌘U marks unread, ⌘⇧Z undoes", () => {
    expect(matchBinding(stroke({ key: "e", metaKey: true }))?.commandId).toBe("conversation.settle");
    expect(matchBinding(stroke({ key: "u", metaKey: true }))?.commandId).toBe("conversation.markUnread");
    expect(matchBinding(stroke({ key: "z", metaKey: true, shiftKey: true }))?.commandId).toBe("action.undo");
  });

  test("the triage chords fire from the composer and swallow the browser default", () => {
    // The whole point of moving triage off bare letters: opening a conversation
    // focuses the composer, so a shortcut that can't fire from a text field
    // can't be used where triage actually happens.
    const chords = [
      stroke({ key: "e", metaKey: true }),
      stroke({ key: "u", metaKey: true }),
      stroke({ key: "z", metaKey: true, shiftKey: true }),
    ];
    for (const chord of chords) {
      const binding = matchBinding(chord);
      expect(binding?.allowInEditable).toBe(true);
      expect(binding?.preventDefault).toBe(true);
    }
  });

  test("the triage chords fire in glide mode too — they are not list-scope", () => {
    setListMode(true);
    const binding = matchBinding(stroke({ key: "e", metaKey: true }));
    expect(binding?.commandId).toBe("conversation.settle");
    expect(binding?.scope).toBe("global");
  });

  test("⌘Z is left alone so the composer keeps its own text undo", () => {
    expect(matchBinding(stroke({ key: "z", metaKey: true }))).toBeNull();
  });

  test("retired chords are gone: ⌘⇧E, ⌘⇧U, ⌘↑/⌘↓", () => {
    // ⌘E and ⌘U are bound; the SHIFTED forms they were once mistaken for are not.
    expect(matchBinding(stroke({ key: "e", metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchBinding(stroke({ key: "u", metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchBinding(stroke({ key: "arrowdown", metaKey: true }))).toBeNull();
    expect(matchBinding(stroke({ key: "arrowup", metaKey: true }))).toBeNull();
  });
});

describe("bare keys and glide (list) mode", () => {
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

  test("the deleted bare action keys match nothing, in glide or out of it", () => {
    for (const listMode of [false, true]) {
      setListMode(listMode);
      for (const key of ["e", "u", "z", "c", "h", "/"]) {
        expect(matchBinding(stroke({ key }))).toBeNull();
      }
      expect(matchBinding(stroke({ key: "?", shiftKey: true }))).toBeNull();
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

  test("glide changes the meaning of exactly one key: Enter", () => {
    const keys = ["e", "u", "z", "c", "/", "h", "j", "k", "arrowdown", "arrowup", "enter"];
    setListMode(false);
    const off = keys.map((key) => matchBinding(stroke({ key }))?.commandId ?? null);
    setListMode(true);
    const on = keys.map((key) => matchBinding(stroke({ key }))?.commandId ?? null);

    expect(keys.filter((_, i) => off[i] !== on[i])).toEqual(["enter"]);
  });

  test("the surviving glide binding is not editable-safe (fail-closed input)", () => {
    setListMode(true);
    expect(matchBinding(stroke({ key: "Enter" }))?.allowInEditable).toBe(false);
  });

  test("navigation repeats; actions do not", () => {
    expect(matchBinding(stroke({ key: "j" }))?.allowRepeat).toBe(true);
    expect(matchBinding(stroke({ key: "e", metaKey: true }))?.allowRepeat).toBe(false);
    setListMode(true);
    expect(matchBinding(stroke({ key: "Enter" }))?.allowRepeat).toBe(false);
  });
});

describe("registry", () => {
  test("formatCombo renders mac-style symbols", () => {
    expect(formatCombo("mod+k")).toBe("⌘K");
    expect(formatCombo("mod+shift+z")).toBe("⌘⇧Z");
    expect(formatCombo("arrowdown")).toBe("↓");
    expect(formatCombo("escape")).toBe("Esc");
  });

  test("help advertises the triage chords and hides the shell-only ones", () => {
    const entries = helpEntries();
    expect(entries.find((e) => e.title === "Next conversation")?.keys).toEqual(["J", "↓"]);
    expect(entries.find((e) => e.title === "Settle / un-settle conversation")?.keys).toEqual(["⌘E"]);
    expect(entries.find((e) => e.title === "Mark unread")?.keys).toEqual(["⌘U"]);
    expect(entries.find((e) => e.title === "Undo last action")?.keys).toEqual(["⌘⇧Z"]);
    expect(entries.find((e) => e.title === "Close panel / window")).toBeUndefined();
    // ⌘N is browser-reserved (so: hidden) and bare `c` is gone, which leaves New
    // message with no advertised key. The native menu is where the shell shows it.
    expect(entries.find((e) => e.title === "New message")).toBeUndefined();
  });

  test("isCommandId accepts registry ids only", () => {
    expect(isCommandId("conversation.settle")).toBe(true);
    expect(isCommandId("conversation.archive")).toBe(false);
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
