import { Platform, StyleSheet, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";
import { TriageSummary } from "./triage-summary";

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export const TRIAGE_QUEUE_HEADER_HEIGHT = 112;

export function TriageQueueHeader({
  title,
  remaining,
  completed,
  sweepCount,
  oldestAt,
  search,
  action,
  onSweep,
}: {
  title: string;
  remaining: number;
  completed: number;
  sweepCount: number;
  oldestAt: number | null;
  search: React.ReactNode;
  action: React.ReactNode;
  onSweep: () => void;
}): React.JSX.Element {
  const visual = useTriageTheme();
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.queue,
    backdropFilter: "blur(40px) saturate(1.5)",
    WebkitBackdropFilter: "blur(40px) saturate(1.5)",
  } as object) : { backgroundColor: visual.queue };
  return (
    <View testID="triage-queue-header" style={[styles.header, glass, { borderBottomColor: visual.hairline }]} {...DRAG}>
      <TriageSummary title={title} remaining={remaining} sweepCount={sweepCount} completed={completed} oldestAt={oldestAt} onSweep={onSweep} />
      <View style={styles.toolbar} {...NO_DRAG}>
        {search}
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: 0.5,
    height: TRIAGE_QUEUE_HEADER_HEIGHT,
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 10,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
});
