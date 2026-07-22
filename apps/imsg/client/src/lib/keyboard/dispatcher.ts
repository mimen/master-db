import { Platform } from "react-native";
import { matchBinding, runCommand } from "./controller";

/**
 * THE one application keydown listener (capture phase — react-native-web's
 * TextInput stops keydown bubbling while focused, so bubble-phase listeners
 * never see shortcuts typed in the composer). No-ops on native: browser
 * globals are only touched inside install(), never at module scope.
 */

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}

export function installKeyboardDispatcher(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    // IME composition, dead keys, and AltGraph chords are text input, not shortcuts.
    if (event.isComposing || event.keyCode === 229 || event.key === "Process" || event.key === "Dead") return;
    if (event.getModifierState?.("AltGraph")) return;

    const binding = matchBinding(event);
    if (!binding) return;
    if (event.repeat && !binding.allowRepeat) return;
    // Fail closed: a binding not marked editable-safe never fires from a text field,
    // even if scope bookkeeping is stale.
    if (isEditableTarget(event.target) && !binding.allowInEditable) return;

    if (binding.preventDefault) event.preventDefault();
    runCommand(binding.commandId, "keyboard");
  };

  document.addEventListener("keydown", onKeyDown, true);
  return () => document.removeEventListener("keydown", onKeyDown, true);
}
