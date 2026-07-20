import { createContext, useCallback, useContext, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";

export interface LightboxMedia {
  url: string;
  isVideo: boolean;
}

type OpenLightbox = (items: LightboxMedia[], index: number) => void;

const LightboxContext = createContext<OpenLightbox>(() => undefined);

export function useLightbox(): OpenLightbox {
  return useContext(LightboxContext);
}

function LightboxVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => p.play());
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />;
}

/** Full-screen media viewer: swipe/arrow between items, tap to dismiss. */
export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<LightboxMedia[]>([]);
  const [index, setIndex] = useState(0);
  const { width } = useWindowDimensions();

  const open = useCallback<OpenLightbox>((media, start) => {
    if (media.length === 0) return;
    setItems(media);
    setIndex(Math.max(0, start));
  }, []);

  const close = () => setItems([]);
  const current = items[index];
  const go = (delta: number) =>
    setIndex((i) => Math.max(0, Math.min(items.length - 1, i + delta)));

  return (
    <LightboxContext.Provider value={open}>
      {children}
      <Modal visible={items.length > 0} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} />
          {current &&
            (current.isVideo ? (
              <LightboxVideo url={current.url} />
            ) : (
              <Image source={{ uri: current.url }} style={styles.media} contentFit="contain" />
            ))}
          <Pressable style={styles.close} onPress={close} hitSlop={10}>
            <Ionicons name="close" size={30} color="#fff" />
          </Pressable>
          {items.length > 1 && (
            <>
              {index > 0 && (
                <Pressable style={[styles.nav, { left: 8 }]} onPress={() => go(-1)} hitSlop={10}>
                  <Ionicons name="chevron-back" size={34} color="#fff" />
                </Pressable>
              )}
              {index < items.length - 1 && (
                <Pressable
                  style={[styles.nav, { right: 8, left: undefined }]}
                  onPress={() => go(1)}
                  hitSlop={10}
                >
                  <Ionicons name="chevron-forward" size={34} color="#fff" />
                </Pressable>
              )}
              <View style={styles.counter}>
                <Text style={{ color: "#fff", fontSize: 13 }}>
                  {index + 1} / {items.length}
                </Text>
              </View>
            </>
          )}
        </View>
      </Modal>
    </LightboxContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  media: {
    width: "100%",
    height: "100%",
  },
  close: {
    position: "absolute",
    top: 44,
    right: 20,
  },
  nav: {
    position: "absolute",
    top: "50%",
    marginTop: -20,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  counter: {
    position: "absolute",
    bottom: 44,
    alignSelf: "center",
  },
});
