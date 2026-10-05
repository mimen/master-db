import { expect, test } from "bun:test";
import { presentActions } from "./action-presentation";

test("today's pending-send menu reads as the mockup: icons, shortcuts, one note, two separators", () => {
  const out = presentActions([
    { label: "Reply" },
    { label: "Copy" },
    { label: "Forward" },
    { label: "Edit · available once sent" },
    { label: "Unsend · available once sent" },
    { label: "Delete for Me" },
  ]);
  expect(out).toEqual([
    { label: "Reply", icon: "arrow-undo-outline", shortcut: "⌘R", note: undefined, separatorBefore: false },
    { label: "Copy", icon: "copy-outline", shortcut: "⌘C", note: undefined, separatorBefore: false },
    { label: "Forward", icon: "arrow-redo-outline", shortcut: undefined, note: undefined, separatorBefore: false },
    { label: "Edit", icon: "pencil-outline", shortcut: undefined, note: undefined, separatorBefore: true },
    { label: "Unsend", icon: "arrow-undo-circle-outline", shortcut: undefined, note: "Available once it's sent", separatorBefore: false },
    { label: "Delete for Me", icon: "trash-outline", shortcut: "⌫", note: undefined, separatorBefore: true },
  ]);
});

test("a timed label keeps its countdown and a missing block draws no stray separator", () => {
  const out = presentActions([{ label: "Copy" }, { label: "Unsend · 1 min" }, { label: "Delete for Me" }]);
  expect(out.map((a) => [a.label, a.separatorBefore])).toEqual([
    ["Copy", false],
    ["Unsend · 1 min", true],
    ["Delete for Me", true],
  ]);
});

test("explicit fields win over the derived ones", () => {
  const [a] = presentActions([
    { label: "Delete", icon: "close", shortcut: "⌘D", note: "Only for you", separatorBefore: true },
  ]);
  expect(a).toEqual({ label: "Delete", icon: "close", shortcut: "⌘D", note: "Only for you", separatorBefore: true });
});

test("labels outside the table render bare", () => {
  expect(presentActions([{ label: "❤️  You" }])).toEqual([
    { label: "❤️  You", icon: undefined, shortcut: undefined, note: undefined, separatorBefore: false },
  ]);
});
