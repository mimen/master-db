import { useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEventListener } from "expo";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { useTheme } from "@/hooks/use-theme";
import { formatFileSize } from "./message-meta";
import { HOVER_DIM, PRESS_DIM, Radii, Type } from "@/constants/theme";
import { useQuery } from "convex/react";
import { mediaApi } from "@/lib/media-api";
import { runCommand } from "@/lib/convex-commands";
import type { TranscriptState } from "@shared/types";

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

export function MediaUnavailable({ onMac }: { onMac?: boolean }) {
  const theme = useTheme();
  // Messages never fetched the file, so no retry here can produce it; say so instead of "pending".
  const label = onMac === false ? "Not downloaded on the Mac" : "Media pending or unavailable";
  return <View accessibilityLabel={label} style={{ padding: 16, alignItems: "center", justifyContent: "center" }}>
    <Ionicons name={onMac === false ? "cloud-offline-outline" : "cloud-download-outline"} size={20} color={theme.textSecondary} />
    <Text style={{ color: theme.textSecondary }}>{label}</Text>
  </View>;
}

export function AudioBubble({ guid, chatGuid, url, mine }: { guid: string; chatGuid: string; url: string; mine: boolean }) {
  const theme = useTheme();
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const tint = mine ? theme.onAccent : theme.text;
  // Alpha-dimmed white with no matching token — left as a literal.
  const dimTint = mine ? "rgba(255,255,255,0.4)" : theme.divider;
  const waveform = useMemo(() => fakeWaveform(url), [url]);
  const [rateIndex, setRateIndex] = useState(0);
  const state = useQuery(mediaApi.transcriptState, { attachmentGuid: guid });
  const [requestState, setRequestState] = useState<TranscriptState | null>(null);
  const transcript = state?.state === "ready" ? state : requestState ?? state ?? { state: "not-requested" as const };
  const requestTranscript = async () => {
    setRequestState({ state: "working" });
    try {
      await runCommand(chatGuid, { kind: "transcribe", attachmentGuid: guid });
      setRequestState(null);
    } catch {
      setRequestState({ state: "failed", error: "Transcript request failed" });
    }
  };

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

  // Transcript lines sit on the thread background, outside the colored pill.
  const transcriptColor = mine ? "rgba(255,255,255,0.85)" : theme.textSecondary;
  return (
    <View style={styles.audioStack}>
      <View style={[styles.audio, mine ? { backgroundColor: theme.bubbleMine, borderColor: theme.bubbleMine } : { backgroundColor: theme.bubbleTheirs, borderColor: theme.bubbleTheirsBorder }]}>
        <Pressable onPress={toggle} hitSlop={8} style={({ hovered, pressed }) => [styles.playButton, { backgroundColor: mine ? "rgba(255,255,255,0.9)" : theme.field }, hovered && !pressed && styles.mediaControlHover, pressed && styles.mediaControlPress]}>
          {/* mine's play button sits on a near-white translucent circle regardless
              of theme — black icon is deliberate, not a theme.text substitute. */}
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
        <Text style={[styles.audioTime, { color: transcriptColor }]}>
          {active
            ? `${formatSeconds(status.currentTime)} / ${formatSeconds(status.duration)}`
            : formatSeconds(status.duration)}
        </Text>
        {active && (
          <Pressable onPress={cycleRate} style={({ hovered, pressed }) => [styles.rateChip, { borderColor: dimTint }, hovered && !pressed && styles.mediaControlHover, pressed && styles.mediaControlPress]}>
            <Text style={[styles.rateText, { color: tint }]}>{RATES[rateIndex]}x</Text>
          </Pressable>
        )}
      </View>
      {transcript.state === "not-requested" && (
        <Pressable onPress={() => void requestTranscript()} hitSlop={6} style={({ hovered, pressed }) => [hovered && !pressed && styles.mediaControlHover, pressed && styles.mediaControlPress]}>
          <Text style={[styles.transcriptAction, { color: theme.accent }]}>Transcribe</Text>
        </Pressable>
      )}
      {transcript.state === "working" && (
        <Text style={[styles.transcriptMeta, { color: theme.textSecondary }]}>Transcribing on the Mini…</Text>
      )}
      {transcript.state === "ready" && (
        <Text selectable style={[styles.transcriptText, { color: theme.text }]}>
          {transcript.text}
        </Text>
      )}
      {transcript.state === "unavailable" && (
        <Text style={[styles.transcriptMeta, { color: theme.textSecondary }]}>Transcription unavailable · {transcript.detail}</Text>
      )}
      {transcript.state === "failed" && (
        <View style={{ gap: 3 }}>
          <Text style={[styles.transcriptMeta, { color: theme.textSecondary }]}>{transcript.error}</Text>
          <Pressable onPress={() => void requestTranscript()} hitSlop={6} style={({ hovered, pressed }) => [hovered && !pressed && styles.mediaControlHover, pressed && styles.mediaControlPress]}>
            <Text style={[styles.transcriptAction, { color: theme.accent }]}>Retry transcription</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** A non-media attachment: a download glyph, its name, and its size when known. */
export function FileCard({ filename, bytes, onPress }: { filename: string; bytes: number | null; onPress: () => void }) {
  const theme = useTheme();
  const action = Platform.OS === "web" ? "Click to download" : "Tap to download";
  const detail = bytes !== null && bytes > 0 ? `${formatFileSize(bytes)}. ${action}` : action;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${filename}, ${detail}`}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.file,
        { backgroundColor: theme.surface, borderColor: theme.dividerStrong },
        (hovered || pressed) && { backgroundColor: theme.rowHover },
      ]}
    >
      <View style={[styles.fileGlyph, { backgroundColor: theme.field }]}>
        <Ionicons name="arrow-down" size={18} color={theme.text} />
      </View>
      <View style={styles.fileText}>
        <Text numberOfLines={1} style={[styles.fileName, { color: theme.text }]}>{filename}</Text>
        <Text numberOfLines={1} style={[styles.fileDetail, { color: theme.textSecondary }]}>{detail}</Text>
      </View>
    </Pressable>
  );
}

function aspectRatio(width: number | null, height: number | null): number {
  return width !== null && height !== null && width > 0 && height > 0 ? width / height : 1;
}

export function VideoBubble({
  url,
  width,
  sourceWidth,
  sourceHeight,
}: {
  url: string;
  width: number;
  sourceWidth: number | null;
  sourceHeight: number | null;
}) {
  const [activated, setActivated] = useState(false);
  const [ratio, setRatio] = useState(() => aspectRatio(sourceWidth, sourceHeight));
  const videoRef = useRef<VideoView>(null);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  useEventListener(player, "sourceLoad", ({ availableVideoTracks }) => {
    const size = availableVideoTracks[0]?.size;
    if (size) setRatio(aspectRatio(size.width, size.height));
  });

  const updateAspectRatio = () => {
    const trackSize = player.videoTrack?.size;
    if (trackSize) {
      setRatio(aspectRatio(trackSize.width, trackSize.height));
      return;
    }
    if (Platform.OS !== "web") return;
    const video: HTMLVideoElement | null = videoRef.current?.nativeRef.current ?? null;
    if (video) setRatio(aspectRatio(video.videoWidth, video.videoHeight));
  };

  return (
    <View style={[styles.video, { width, aspectRatio: ratio }]}>
      <VideoView
        ref={videoRef}
        player={player}
        style={styles.videoFrame}
        contentFit="contain"
        nativeControls
        onFirstFrameRender={updateAspectRatio}
      />
      {!activated && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Play video"
          onPress={() => {
            setActivated(true);
            player.play();
          }}
          style={styles.videoOverlay}
        >
          {/* Play-circle overlay on top of the video frame — theme-invariant
              media control, always white regardless of app theme. */}
          <Ionicons name="play-circle" size={48} color="rgba(255,255,255,0.9)" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  audioStack: {
    gap: 5,
    minWidth: 220,
  },
  audio: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 220,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 20,
    borderWidth: 1,
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
    borderRadius: Radii.chip,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rateText: {
    fontSize: Type.caption,
    fontWeight: "600",
  },
  transcriptAction: {
    fontSize: Type.secondary,
    fontWeight: "600",
    marginHorizontal: 8,
  },
  mediaControlHover: { opacity: HOVER_DIM },
  mediaControlPress: { opacity: PRESS_DIM },
  transcriptMeta: {
    fontSize: Type.caption,
    lineHeight: 16,
    marginHorizontal: 8,
    maxWidth: 260,
  },
  transcriptText: {
    fontSize: Type.secondary,
    lineHeight: 19,
    marginHorizontal: 8,
    maxWidth: 280,
  },
  file: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    height: 64,
    paddingHorizontal: 13,
    width: 268,
  },
  fileGlyph: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  fileText: { flex: 1, gap: 2 },
  fileName: { fontSize: 12.5, fontWeight: "600" },
  fileDetail: { fontSize: 12, fontVariant: ["tabular-nums"] },
  video: {
    borderRadius: 14,
    overflow: "hidden",
    // Letterbox background for the video frame — always black, theme-invariant.
    backgroundColor: "#000",
  },
  videoFrame: {
    width: "100%",
    height: "100%",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
});
