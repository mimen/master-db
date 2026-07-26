import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Physical feedback, fire-and-forget. On iOS this is load-bearing for perceived
 * quality — an action that moves pixels but buzzes nothing reads as unresponsive.
 * Deliberately sparse: send, swipe-commit, tapback, failure. Nothing else.
 */
function fire(run: () => Promise<void>): void {
  if (Platform.OS === "web") return;
  void run().catch(() => undefined); // a missing taptic engine must never break an interaction
}

/** Committing an outbound message — text, attachment, or voice. */
export function hapticSend(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A send came back failed. */
export function hapticFailure(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

/** Crossing a swipe's commit threshold, mid-drag — the moment the action arms. */
export function hapticCommit(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Discrete selection: tapbacks. */
export function hapticSelect(): void {
  fire(() => Haptics.selectionAsync());
}
