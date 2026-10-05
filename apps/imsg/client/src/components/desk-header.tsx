import { Platform, StyleSheet, View } from "react-native";
import { useTriageTheme } from "@/hooks/use-triage-theme";

const DRAG = { dataSet: { tauriDragRegion: "" } } as object;
const NO_DRAG = { dataSet: { tauriDragRegion: "false" } } as object;

export const DESK_HEADER_HEIGHT = 112;
/** Search toolbar over the lens tabs, with no summary row. */
export const DESK_HEADER_WITH_CONTROLS_HEIGHT = 90;

/**
 * The desk-language sidebar header shared by Messages and Contacts: a fixed
 * glass bar with an optional summary row and a search/action toolbar.
 * Messages adds the lens tabs under the toolbar, their underline sitting on
 * the header's bottom rule.
 */
export function DeskHeader({
  summary,
  search,
  action,
  controls,
  testID = "desk-header",
}: {
  summary?: React.ReactNode;
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
      <View style={[styles.toolbar, summary ? null : styles.toolbarFirst]} {...NO_DRAG}>
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
    paddingBottom: 0,
    paddingTop: 12,
  },
  toolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  toolbarFirst: {
    marginTop: 0,
  },
  controls: {
    marginTop: "auto",
  },
});
