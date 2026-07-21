import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { useTheme } from "@/hooks/use-theme";

function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const WAVEFORM_BARS = 22;
const RATES = [1, 1.5, 2] as const;

/**
 * BlueBubbles doesn't hand us decoded audio samples, so there's no real
 * amplitude data to draw from. This fakes a waveform shape that's stable
 * per-message (seeded by the attachment URL) rather than actually
 * analyzing the audio — visually matches a real waveform, isn't one.
 */
function fakeWaveform(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < WAVEFORM_BARS; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(0.25 + (h % 1000) / 1000 * 0.75); // 0.25–1.0 of max bar height
  }
  return bars;
}

export function AudioBubble({ url, mine }: { url: string; mine: boolean }) {
  const theme = useTheme();
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const tint = mine ? "#fff" : theme.text;
  const dimTint = mine ? "rgba(255,255,255,0.4)" : theme.divider;
  const waveform = useMemo(() => fakeWaveform(url), [url]);
  const [rateIndex, setRateIndex] = useState(0);

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

  const cycleRate = () => {
    const next = (rateIndex + 1) % RATES.length;
    setRateIndex(next);
    player.setPlaybackRate(RATES[next] ?? 1);
  };

  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0;
  const playedBars = Math.round(progress * WAVEFORM_BARS);
  const active = playing || status.currentTime > 0;

  return (
    <View style={[styles.audio, { backgroundColor: mine ? "rgba(255,255,255,0.15)" : theme.backgroundElement }]}>
      <Pressable onPress={toggle} hitSlop={8} style={[styles.playButton, { backgroundColor: mine ? "rgba(255,255,255,0.9)" : theme.background }]}>
        <Ionicons name={playing ? "pause" : "play"} size={16} color={mine ? "#000" : theme.text} />
      </Pressable>
      <View style={styles.waveform}>
        {waveform.map((h, i) => (
          <View
            key={i}
            style={{
              width: 2.5,
              borderRadius: 1.5,
              height: Math.max(3, h * 18),
              backgroundColor: i < playedBars ? tint : dimTint,
            }}
          />
        ))}
      </View>
      <Text style={[styles.audioTime, { color: mine ? "rgba(255,255,255,0.8)" : theme.textSecondary }]}>
        {active
          ? `${formatSeconds(status.currentTime)} / ${formatSeconds(status.duration)}`
          : formatSeconds(status.duration)}
      </Text>
      {active && (
        <Pressable onPress={cycleRate} style={[styles.rateChip, { borderColor: dimTint }]}>
          <Text style={[styles.rateText, { color: tint }]}>{RATES[rateIndex]}x</Text>
        </Pressable>
      )}
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
    minWidth: 220,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 20,
  },
  playButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  waveform: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  audioTime: {
    fontSize: 12,
  },
  rateChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rateText: {
    fontSize: 11,
    fontWeight: "600",
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
