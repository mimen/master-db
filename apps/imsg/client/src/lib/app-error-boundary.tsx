import { Component, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

type Props = { children: ReactNode };

type State = { error: Error | null };

/**
 * Last-resort crash net around the whole app. A Convex useQuery that throws
 * (a server timeout, a deploy blip) surfaces as a render-phase exception; an
 * uncaught one unmounts the entire React tree and leaves a permanently white
 * window. This renders a plain fallback with a reload affordance instead, so
 * the failure is visible but recoverable.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("App crashed:", error);
  }

  private reload = (): void => {
    if (Platform.OS === "web" && typeof globalThis.window !== "undefined") {
      globalThis.window.location.reload();
    } else this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.detail} numberOfLines={6}>
          {error.message}
        </Text>
        <Text onPress={this.reload} style={styles.reload}>
          Reload
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    backgroundColor: "#ffffff",
  },
  title: { fontSize: 17, fontWeight: "600" },
  detail: { fontSize: 13, opacity: 0.55, textAlign: "center" },
  reload: { fontSize: 15, fontWeight: "600", color: "#0a84ff", padding: 8 },
});
