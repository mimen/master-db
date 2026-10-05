import { afterAll, beforeAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { emptyLensCopy as CopyFn } from "./empty-lens";

let emptyLensCopy: typeof CopyFn;
const bundlePath = join(import.meta.dir, `.empty-lens-${process.pid}.js`);

beforeAll(async () => {
  // Only the pure copy table is under test, so every UI import is stubbed out.
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "empty-lens.tsx")], target: "bun",
    plugins: [{ name: "stub-ui", setup(build) {
      build.onResolve({ filter: /^(react-native|react\/jsx-dev-runtime|react\/jsx-runtime|@expo\/vector-icons|\.\/avatar|@\/hooks\/.*)$/ }, () => ({ path: "stub", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js",
        contents: "const s = () => null; export const StyleSheet = { create: (x) => x }; export { s as Pressable, s as Text, s as View, s as Ionicons, s as ChatAvatar, s as useColorScheme, s as useLayoutMode, s as useTheme, s as jsx, s as jsxs, s as jsxDEV, s as Fragment };" }));
    } }],
  });
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  await Bun.write(bundlePath, built.outputs[0]);
  ({ emptyLensCopy } = await import(bundlePath));
});

afterAll(() => rm(bundlePath, { force: true }));

test("Needs reply names today's work only when the counts are known", () => {
  expect(emptyLensCopy("unresponded", { unresponded: 0, repliedToday: 18, settledToday: 9 })).toEqual({
    title: "You've replied to everyone",
    line2: "New messages show up here as they arrive. 18 replied and 9 settled today.",
    sectionTitle: "Waiting on them the longest",
    footer: "See all in Waiting",
    footerHint: undefined,
  });
  expect(emptyLensCopy("unresponded", { unresponded: 0 }).line2).toBe("New messages show up here as they arrive.");
  expect(emptyLensCopy("unresponded", { unresponded: 0, repliedToday: 3 }).line2).toBe("New messages show up here as they arrive. 3 replied today.");
});

test("Unread points at what still needs a reply and drops the sentence at zero", () => {
  expect(emptyLensCopy("unread", { unresponded: 41 })).toEqual({
    title: "Nothing unread",
    line2: "You've opened every message. 41 conversations still need a reply.",
    sectionTitle: "Your turn the longest",
    footer: "Go to Needs reply",
    footerHint: "⌘1",
  });
  expect(emptyLensCopy("unread", { unresponded: 1 }).line2).toBe("You've opened every message. 1 conversation still needs a reply.");
  expect(emptyLensCopy("unread", { unresponded: 0 }).line2).toBe("You've opened every message.");
});
