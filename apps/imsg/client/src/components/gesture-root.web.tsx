import { View, type ViewProps } from "react-native";

/**
 * On web the gesture root only provides a context that native builds check, so a plain view
 * keeps gesture-handler out of the entry chunk; the phone row swipe loads it lazily (row-pan).
 */
export function GestureRoot(props: ViewProps): React.JSX.Element {
  return <View {...props} />;
}
