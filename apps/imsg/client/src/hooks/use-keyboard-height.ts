import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * The software keyboard's height on native, 0 on web. Pad a full-height surface's bottom by it:
 * KeyboardAvoidingView applies no padding on this RN/Fabric build, leaving inputs under the keyboard.
 * The reported height already includes the bottom safe-area strip.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const change = Keyboard.addListener("keyboardWillChangeFrame", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      change.remove();
      hide.remove();
    };
  }, []);
  return height;
}
