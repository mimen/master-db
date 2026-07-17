import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { useTheme } from "@/hooks/use-theme";

function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AudioBubble({ url, mine }: { url: string; mine: boolean }) {
  const theme = useTheme();
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const tint = mine ? "#fff" : theme.text;

  const toggle = () => {
    if (playing) {
      player.pause();
      return;
    }
    // Replay from the start when it already finished.
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }
    player.play();
  };

  const progress =
    status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;

  return (
    <View style={styles.audio}>
      <Pressable onPress={toggle} hitSlop={8}>
        <Ionicons name={playing ? "pause-circle" : "play-circle"} size={34} color={tint} />
      </Pressable>
      <View style={styles.audioBody}>
        <View style={[styles.audioTrack, { backgroundColor: mine ? "rgba(255,255,255,0.35)" : theme.divider }]}>
          <View
            style={[
              styles.audioFill,
              { width: `${progress * 100}%`, backgroundColor: tint },
            ]}
          />
        </View>
        <Text style={[styles.audioTime, { color: mine ? "rgba(255,255,255,0.8)" : theme.textSecondary }]}>
          {formatSeconds(playing || status.currentTime > 0 ? status.currentTime : status.duration)}
        </Text>
      </View>
    </View>
  );
}

export function VideoBubble({ url }: { url: string }) {
  const [activated, setActivated] = useState(false);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  return (
    <Pressable
      onPress={() => {
        if (!activated) setActivated(true);
        else if (player.playing) player.pause();
        else player.play();
      }}
    >
      <View style={styles.video}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          nativeControls
        />
        {!activated && (
          <View style={styles.videoOverlay}>
            <Ionicons name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  audio: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 180,
    paddingVertical: 2,
  },
  audioBody: {
    flex: 1,
    gap: 4,
  },
  audioTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  audioFill: {
    height: "100%",
    borderRadius: 2,
  },
  audioTime: {
    fontSize: 11,
  },
  video: {
    width: 230,
    aspectRatio: 4 / 3,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
