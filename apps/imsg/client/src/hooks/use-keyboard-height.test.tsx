import { expect, mock, test } from "bun:test";

if (process.env.COMMA_KEYBOARD_HOOK_CHILD !== "1") {
  test("keyboard height follows the native keyboard's frame and returns to 0 on hide", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.filename], {
      cwd: import.meta.dir,
      env: { ...process.env, COMMA_KEYBOARD_HOOK_CHILD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exit, output: exit ? stdout + stderr : "" }).toEqual({ exit: 0, output: "" });
  });
} else {
  const { JSDOM } = await import("jsdom");
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const dom = new JSDOM("<div id='root'></div>");
  Object.assign(globalThis, { window: dom.window, document: dom.window.document });
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

  type Listener = (event: { endCoordinates: { height: number } }) => void;
  const listeners = new Map<string, Listener>();
  mock.module("react-native", () => ({
    Platform: { OS: "ios" },
    Keyboard: {
      addListener: (name: string, listener: Listener) => {
        listeners.set(name, listener);
        return { remove: () => listeners.delete(name) };
      },
    },
  }));
  const { useKeyboardHeight } = await import("./use-keyboard-height");
  let height: number | undefined;
  function Probe() {
    height = useKeyboardHeight();
    return null;
  }

  test("pads by the keyboard frame and drops its listeners on unmount", async () => {
    const root = createRoot(document.getElementById("root")!);
    await act(async () => { root.render(createElement(Probe)); });
    expect(height).toBe(0);

    await act(async () => { listeners.get("keyboardWillChangeFrame")!({ endCoordinates: { height: 336 } }); });
    expect(height).toBe(336);

    await act(async () => { listeners.get("keyboardWillHide")!({ endCoordinates: { height: 0 } }); });
    expect(height).toBe(0);

    await act(async () => { root.unmount(); });
    expect(listeners.size).toBe(0);
    dom.window.close();
  });
}
