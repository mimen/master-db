import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEventListener } from "expo";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { useTheme } from "@/hooks/use-theme";
import { Radii, Type } from "@/constants/theme";
import { api } from "@/lib/api";
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

export function AudioBubble({ guid, url, mine }: { guid: string; url: string; mine: boolean }) {
  const theme = useTheme();
  const player = useAudioPlayer({ uri: url });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const tint = mine ? theme.onAccent : theme.text;
  // Alpha-dimmed white with no matching token — left as a literal.
  const dimTint = mine ? "rgba(255,255,255,0.4)" : theme.divider;
  const waveform = useMemo(() => fakeWaveform(url), [url]);
  const [rateIndex, setRateIndex] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptState>({ state: "not-requested" });

  useEffect(() => {
    let cancelled = false;
    api
      .transcriptState(guid)
      .then((state) => {
        if (!cancelled) setTranscript(state);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [guid]);

  useEffect(() => {
    if (transcript.state !== "working") return;
    let cancelled = false;
    const poll = (): void => {
      api
        .transcriptState(guid)
        .then((state) => {
          if (!cancelled) setTranscript(state);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [guid, transcript.state]);

  const requestTranscript = async () => {
    setTranscript({ state: "working" });
    try {
      setTranscript(await api.transcribe(guid));
    } catch {
      setTranscript({ state: "failed", error: "Transcript request failed" });
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

  const transcriptColor = mine ? "rgba(255,255,255,0.85)" : theme.textSecondary;
  return (
    <View style={styles.audioStack}>
      <View style={[styles.audio, { backgroundColor: mine ? "rgba(255,255,255,0.15)" : theme.backgroundElement }]}>
        <Pressable onPress={toggle} hitSlop={8} style={[styles.playButton, { backgroundColor: mine ? "rgba(255,255,255,0.9)" : theme.background }]}>
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
          <Pressable onPress={cycleRate} style={[styles.rateChip, { borderColor: dimTint }]}>
            <Text style={[styles.rateText, { color: tint }]}>{RATES[rateIndex]}x</Text>
          </Pressable>
        )}
      </View>
      {transcript.state === "not-requested" && (
        <Pressable onPress={() => void requestTranscript()} hitSlop={6}>
          <Text style={[styles.transcriptAction, { color: mine ? theme.onAccent : theme.accent }]}>Transcribe</Text>
        </Pressable>
      )}
      {transcript.state === "working" && (
        <Text style={[styles.transcriptMeta, { color: transcriptColor }]}>Transcribing on the Mini…</Text>
      )}
      {transcript.state === "ready" && (
        <Text selectable style={[styles.transcriptText, { color: mine ? theme.onAccent : theme.text }]}>
          {transcript.text}
        </Text>
      )}
      {transcript.state === "unavailable" && (
        <Text style={[styles.transcriptMeta, { color: transcriptColor }]}>Transcription unavailable · {transcript.detail}</Text>
      )}
      {transcript.state === "failed" && (
        <View style={{ gap: 3 }}>
          <Text style={[styles.transcriptMeta, { color: transcriptColor }]}>{transcript.error}</Text>
          <Pressable onPress={() => void requestTranscript()} hitSlop={6}>
            <Text style={[styles.transcriptAction, { color: mine ? theme.onAccent : theme.accent }]}>Retry transcription</Text>
          </Pressable>
        </View>
      )}
    </View>
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
  video: {
    borderRadius: Radii.card,
    overflow: "hidden",
    // Letterbox background for the video frame — always black, theme-invariant.
    backgroundColor: "#000",
  },
  videoFrame: {
    width: "100%",
    height: "100%",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
