import { Platform, StyleSheet, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export const DESK_HEADER_HEIGHT = 112;

/**
 * The desk-language sidebar header shared by Messages and Contacts: a fixed
 * glass bar with a summary row on top and a search/action toolbar beneath.
 * Only the summary differs per surface (Messages shows triage progress,
 * Contacts a plain count), so the glass, drag regions, and height live here
 * and stay identical across both panes.
 */
export function DeskHeader({
  summary,
  search,
  action,
  testID = "desk-header",
}: {
  summary: React.ReactNode;
  search: React.ReactNode;
  action: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const visual = useTriageTheme();
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.queue,
    backdropFilter: "blur(40px) saturate(1.5)",
    WebkitBackdropFilter: "blur(40px) saturate(1.5)",
  } as object) : { backgroundColor: visual.queue };
  return (
    <View testID={testID} style={[styles.header, glass, { borderBottomColor: visual.hairline }]} {...DRAG}>
      {summary}
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
    height: DESK_HEADER_HEIGHT,
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
