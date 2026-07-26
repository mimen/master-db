import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer, type VideoTrack } from "expo-video";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { saveMediaToPhotos, shareMedia, type ShareableMedia } from "@/lib/media-actions";
import { showToast } from "@/lib/toast";

export type LightboxMedia = ShareableMedia;

type OpenLightbox = (items: LightboxMedia[], index: number) => void;

interface MediaFrameSize {
  width: number;
  height: number;
}

const LightboxContext = createContext<OpenLightbox>(() => undefined);

export function useLightbox(): OpenLightbox {
  return useContext(LightboxContext);
}

function containedSize(width: number, height: number, aspectRatio: number | null): MediaFrameSize {
  if (!aspectRatio || aspectRatio <= 0) return { width, height };
  if (width / height > aspectRatio) {
    return { width: height * aspectRatio, height };
  }
  return { width, height: width / aspectRatio };
}

function LightboxVideo({
  url,
  onAspectRatio,
}: {
  url: string;
  onAspectRatio: (aspectRatio: number) => void;
}) {
  const player = useVideoPlayer(url, (p) => p.play());

  useEffect(() => {
    const reportTrack = (track: VideoTrack | null) => {
      if (track && track.size.width > 0 && track.size.height > 0) {
        onAspectRatio(track.size.width / track.size.height);
      }
    };
    reportTrack(player.videoTrack);
    const subscription = player.addListener("videoTrackChange", ({ videoTrack }) => {
      reportTrack(videoTrack);
    });
    return () => subscription.remove();
  }, [onAspectRatio, player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
    />
  );
}

/** Full-screen media viewer with direct-manipulation dismissal and media actions. */
export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<LightboxMedia[]>([]);
  const [index, setIndex] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const [activeAction, setActiveAction] = useState<"save" | "share" | null>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const translationY = useSharedValue(0);

  const open = useCallback<OpenLightbox>((media, start) => {
    if (media.length === 0) return;
    translationY.value = 0;
    setAspectRatio(null);
    setActiveAction(null);
    setItems(media);
    setIndex(Math.max(0, Math.min(media.length - 1, start)));
  }, [translationY]);

  const close = useCallback(() => {
    translationY.value = 0;
    setActiveAction(null);
    setItems([]);
  }, [translationY]);

  const current = items[index];
  const go = (delta: number) => {
    translationY.value = 0;
    setAspectRatio(null);
    setIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta)));
  };
  const runAction = async (action: "save" | "share") => {
    if (!current || activeAction) return;
    setActiveAction(action);
    const result = action === "save"
      ? await saveMediaToPhotos(current)
      : await shareMedia(current);
    setActiveAction(null);
    if (action === "save" || !result.ok) {
      showToast(result.ok ? "Saved to Photos" : result.message);
    }
  };

  const dismissGesture = useMemo(
    () => Gesture.Pan()
      // Horizontal movement belongs to video scrubbing and future paging.
      .activeOffsetY(12)
      .failOffsetX([-18, 18])
      .onUpdate((event) => {
        translationY.value = Math.max(0, event.translationY);
      })
      .onEnd((event) => {
        const shouldDismiss = translationY.value > Math.min(150, height * 0.2)
          || (translationY.value > 28 && event.velocityY > 900);
        if (shouldDismiss) {
          if (reducedMotion) {
            runOnJS(close)();
            return;
          }
          translationY.value = withTiming(
            height,
            { duration: 180, reduceMotion: ReduceMotion.System },
            (finished) => {
              if (finished) runOnJS(close)();
            },
          );
          return;
        }
        if (reducedMotion) {
          translationY.value = 0;
          return;
        }
        translationY.value = withSpring(0, {
          damping: 24,
          stiffness: 260,
          reduceMotion: ReduceMotion.System,
        });
      }),
    [close, height, reducedMotion, translationY],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translationY.value,
      [0, height * 0.7],
      [0.95, 0],
      Extrapolation.CLAMP,
    ),
  }));
  const mediaStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translationY.value },
      {
        scale: reducedMotion
          ? 1
          : interpolate(translationY.value, [0, height], [1, 0.88], Extrapolation.CLAMP),
      },
    ],
  }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion
      ? 1
      : interpolate(translationY.value, [0, 60], [1, 0], Extrapolation.CLAMP),
  }));
  const frame = containedSize(width, height, aspectRatio);

  return (
    <LightboxContext.Provider value={open}>
      {children}
      <Modal
        visible={items.length > 0}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={close}
        statusBarTranslucent
      >
        <View style={styles.viewer}>
          <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityLabel="Close media viewer"
          />
          {current && (
            <View pointerEvents="box-none" style={styles.mediaLayer}>
              <GestureDetector gesture={dismissGesture}>
                <Animated.View style={[styles.mediaFrame, frame, mediaStyle]}>
                  {current.isVideo ? (
                    <LightboxVideo
                      key={current.url}
                      url={current.url}
                      onAspectRatio={setAspectRatio}
                    />
                  ) : (
                    <Image
                      key={current.url}
                      source={{ uri: current.url }}
                      style={StyleSheet.absoluteFill}
                      contentFit="contain"
                      onLoad={({ source }) => {
                        if (source.width > 0 && source.height > 0) {
                          setAspectRatio(source.width / source.height);
                        }
                      }}
                    />
                  )}
                </Animated.View>
              </GestureDetector>
            </View>
          )}

          {/* Fixed high-contrast controls over media are theme-invariant by design. */}
          <Animated.View
            pointerEvents="box-none"
            style={[styles.topControls, { top: Math.max(insets.top, 12) + 8 }, controlsStyle]}
          >
            {current && Platform.OS !== "web" ? (
              <View style={styles.actionRow}>
                <Pressable
                  style={({ pressed }) => [styles.roundButton, pressed && styles.controlPressed]}
                  onPress={() => void runAction("share")}
                  disabled={activeAction !== null}
                  accessibilityLabel="Share attachment"
                >
                  {activeAction === "share" ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="share-outline" size={21} color="#fff" />
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.roundButton, pressed && styles.controlPressed]}
                  onPress={() => void runAction("save")}
                  disabled={activeAction !== null}
                  accessibilityLabel="Save to Photos"
                >
                  {activeAction === "save" ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="download-outline" size={21} color="#fff" />
                  )}
                </Pressable>
              </View>
            ) : (
              <View style={styles.actionRow} />
            )}
            <Pressable
              style={({ pressed }) => [styles.doneButton, pressed && styles.controlPressed]}
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Done"
            >
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </Animated.View>

          {items.length > 1 && (
            <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, controlsStyle]}>
              {index > 0 && (
                <Pressable style={[styles.nav, { left: 8 }]} onPress={() => go(-1)} hitSlop={10}>
                  <Ionicons name="chevron-back" size={34} color="#fff" />
                </Pressable>
              )}
              {index < items.length - 1 && (
                <Pressable style={[styles.nav, { right: 8 }]} onPress={() => go(1)} hitSlop={10}>
                  <Ionicons name="chevron-forward" size={34} color="#fff" />
                </Pressable>
              )}
              <View style={[styles.counter, { bottom: Math.max(insets.bottom, 16) + 12 }]}>
                <Text style={styles.counterText}>
                  {index + 1} / {items.length}
                </Text>
              </View>
            </Animated.View>
          )}
        </View>
      </Modal>
    </LightboxContext.Provider>
  );
}

const styles = StyleSheet.create({
  viewer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  mediaLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaFrame: {
    maxWidth: "100%",
    maxHeight: "100%",
  },
  topControls: {
    position: "absolute",
    left: 16,
    right: 16,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 2,
  },
  actionRow: {
    minWidth: 98,
    flexDirection: "row",
    gap: 10,
  },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22,22,24,0.82)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.42)",
  },
  doneButton: {
    minWidth: 68,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "rgba(22,22,24,0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.5)",
  },
  doneText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  controlPressed: {
    opacity: 0.72,
  },
  nav: {
    position: "absolute",
    top: "50%",
    marginTop: -22,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(22,22,24,0.72)",
  },
  counter: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "rgba(22,22,24,0.72)",
  },
  counterText: {
    color: "#fff",
    fontSize: 13,
  },
});
