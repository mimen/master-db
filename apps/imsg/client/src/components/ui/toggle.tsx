import { Switch } from "react-native";

import { useTheme } from "@/hooks/use-theme";

/** The one switch: ink track when on, a visible gray track when off. Web needs `activeThumbColor` or the thumb turns teal. */
export function Toggle({ value, onValueChange, accessibilityLabel, disabled }: {
  readonly value: boolean;
  readonly onValueChange?: (value: boolean) => void;
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const thumb = value ? theme.background : theme.onAccent;
  return (
    <Switch
      accessibilityLabel={accessibilityLabel}
      value={value}
      disabled={disabled}
      onValueChange={onValueChange}
      trackColor={{ true: theme.switchOn, false: theme.switchOff }}
      thumbColor={thumb}
      {...({ activeThumbColor: thumb } as object)}
    />
  );
}
