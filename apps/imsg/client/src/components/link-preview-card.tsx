import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openExternalUrl } from "@/lib/external-link";
import { Image } from "expo-image";
import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { LinkPreview } from "@shared/link-preview";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { HOVER_DIM } from "@/constants/theme";

const fetchLinkPreviewRef = makeFunctionReference<"action", { url: string }, LinkPreview | null>("comma/linkPreview:fetchLinkPreview");

const cache = new Map<string, LinkPreview | null>();
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/;

export function firstUrl(text: string): string | null {
  return text.match(URL_PATTERN)?.[0] ?? null;
}

export function LinkPreviewCard({ url, mine }: { url: string; mine: boolean }) {
  const scheme = useColorScheme();
  const fetchLinkPreview = useAction(fetchLinkPreviewRef);
  const [preview, setPreview] = useState<LinkPreview | null | undefined>(
    cache.has(url) ? cache.get(url) : undefined,
  );

  useEffect(() => {
    if (cache.has(url)) {
      setPreview(cache.get(url));
      return;
    }
    setPreview(undefined);
    let cancelled = false;
    fetchLinkPreview({ url })
      .then((data) => {
        cache.set(url, data);
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        cache.set(url, null);
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, fetchLinkPreview]);

  if (!preview) return null;

  const signal = SIGNAL[scheme === "dark" ? "dark" : "light"];
  const host = new URL(url).hostname.replace(/^www\./, "");

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={preview.title ? `${preview.title}, ${host}` : host}
      onPress={() => void openExternalUrl(url)}
      style={({ hovered, pressed }) => [
        styles.card,
        mine && styles.mine,
        { backgroundColor: signal.surface, borderColor: signal.bubbleTheirsBorder },
        (hovered || pressed) && { opacity: HOVER_DIM },
      ]}
    >
      {preview.image && (
        <Image source={{ uri: preview.image }} style={styles.image} contentFit="cover" />
      )}
      <View style={styles.body}>
        {preview.title && (
          <Text numberOfLines={2} style={[styles.title, { color: signal.text }]}>
            {preview.title}
          </Text>
        )}
        <Text numberOfLines={1} style={[styles.site, { color: signal.textSecondary }]}>
          {preview.siteName ?? host}
        </Text>
      </View>
    </Pressable>
  );
}

// TODO(signal-tokens): read from tokens.ts once U1 lands
const SIGNAL = {
  light: { surface: "#FFFFFF", bubbleTheirsBorder: "rgba(0,0,0,0.07)", text: "#17171A", textSecondary: "#55555C" },
  dark: { surface: "#1C1C1F", bubbleTheirsBorder: "rgba(255,255,255,0.05)", text: "#EDEDEF", textSecondary: "#A6A6AD" },
} as const;

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    width: 340,
    maxWidth: "100%",
  },
  mine: {
    alignSelf: "flex-end",
  },
  image: {
    width: "100%",
    height: 150,
  },
  body: {
    paddingHorizontal: 13,
    paddingTop: 10,
    paddingBottom: 11,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  site: {
    fontSize: 12.5,
  },
});
