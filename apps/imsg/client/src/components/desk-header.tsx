import { Platform, StyleSheet, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export const DESK_HEADER_HEIGHT = 112;
/** Title row, toolbar, and a segmented control, packed tight. */
export const DESK_HEADER_WITH_CONTROLS_HEIGHT = 120;

/**
 * The desk-language sidebar header shared by Messages and Contacts: a fixed
 * glass bar with a summary row on top and a search/action toolbar beneath.
 * Messages adds a controls row (the state segments) under the toolbar.
 */
export function DeskHeader({
  summary,
  search,
  action,
  controls,
  testID = "desk-header",
}: {
  summary: React.ReactNode;
  search: React.ReactNode;
  action: React.ReactNode;
  controls?: React.ReactNode;
  testID?: string;
}): React.JSX.Element {
  const visual = useTriageTheme();
  const glass = Platform.OS === "web" ? ({
    backgroundColor: visual.queue,
    backdropFilter: "blur(40px) saturate(1.5)",
    WebkitBackdropFilter: "blur(40px) saturate(1.5)",
  } as object) : { backgroundColor: visual.queue };
  return (
    <View
      testID={testID}
      style={[styles.header, controls ? styles.headerWithControls : null, glass, { borderBottomColor: visual.hairline }]}
      {...DRAG}
    >
      {summary}
      <View style={[styles.toolbar, controls ? styles.toolbarTight : null]} {...NO_DRAG}>
        {search}
        {action}
      </View>
      {controls ? <View style={styles.controls} {...NO_DRAG}>{controls}</View> : null}
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
  headerWithControls: {
    height: DESK_HEADER_WITH_CONTROLS_HEIGHT,
    paddingBottom: 8,
    paddingTop: 10,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  toolbarTight: {
    marginTop: 8,
  },
  controls: {
    marginTop: 8,
  },
});
