import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = { children: ReactNode };

type State = { error: Error | null; componentStack: string | null };

const LAST_CRASH_KEY = "imsg.lastCrash";

function persistCrash(error: Error, info: ErrorInfo): void {
  const payload = {
    message: error.message,
    stack: error.stack ?? null,
    componentStack: info.componentStack ?? null,
    at: new Date().toISOString(),
  };
  console.error("App crashed:", payload);
  if (Platform.OS !== "web") return;
  try {
    globalThis.localStorage?.setItem(LAST_CRASH_KEY, JSON.stringify(payload));
  } catch {
    // storage full or unavailable — the on-screen stack is the fallback
  }
}

/**
 * Last-resort crash net around the whole app. A Convex useQuery that throws
 * (a server timeout, a deploy blip) surfaces as a render-phase exception; an
 * uncaught one unmounts the entire React tree and leaves a permanently white
 * window. This renders a plain fallback with a reload affordance instead, so
 * the failure is visible but recoverable.
 *
 * Production React minifies exception messages (#185 etc.). The component
 * stack from `componentDidCatch` is the only remaining locator, so it is
 * shown on this screen and written to localStorage (`imsg.lastCrash`).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    persistCrash(error, info);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private reload = (): void => {
    if (Platform.OS === "web" && typeof globalThis.window !== "undefined") {
      globalThis.window.location.reload();
    } else this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const stack = [error.stack, componentStack].filter(Boolean).join("\n\n");
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.detail}>{error.message}</Text>
        {stack.length > 0 && (
          <ScrollView style={styles.stackWrap} contentContainerStyle={styles.stackContent}>
            <Text selectable style={styles.stack}>
              {stack}
            </Text>
          </ScrollView>
        )}
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
  stackWrap: {
    alignSelf: "stretch",
    maxHeight: 280,
    backgroundColor: "#f4f4f5",
    borderRadius: 8,
  },
  stackContent: { padding: 12 },
  stack: { fontSize: 11, fontFamily: Platform.select({ web: "ui-monospace, Menlo, monospace", default: "monospace" }), opacity: 0.8 },
  reload: { fontSize: 15, fontWeight: "600", color: "#0a84ff", padding: 8 },
});
