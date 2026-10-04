import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { openExternalUrl } from "@/lib/external-link";
import { Image } from "expo-image";
import { useAction } from "convex/react";
import { makeFunctionReference } from "convex/server";
import type { LinkPreview } from "@shared/link-preview";
import { useTheme } from "@/hooks/use-theme";
import { HOVER_DIM, Radii, Type } from "@/constants/theme";

const fetchLinkPreviewRef = makeFunctionReference<"action", { url: string }, LinkPreview | null>("comma/linkPreview:fetchLinkPreview");

const cache = new Map<string, LinkPreview | null>();
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/;

export function firstUrl(text: string): string | null {
  return text.match(URL_PATTERN)?.[0] ?? null;
}

export function LinkPreviewCard({ url, mine }: { url: string; mine: boolean }) {
  const theme = useTheme();
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

  const textColor = mine ? theme.onAccent : theme.text;
  // Dimmed white, not a solid onAccent — no token for this specific alpha.
  const secondary = mine ? "rgba(255,255,255,0.7)" : theme.textSecondary;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={preview.title ? `${preview.title}, ${new URL(url).hostname}` : new URL(url).hostname}
      onPress={() => void openExternalUrl(url)}
      style={({ hovered, pressed }) => [
        styles.card,
        { backgroundColor: mine ? "rgba(255,255,255,0.14)" : theme.backgroundElement },
        hovered && !pressed && { backgroundColor: mine ? "rgba(255,255,255,0.22)" : theme.backgroundSelected },
        pressed && { backgroundColor: mine ? "rgba(255,255,255,0.28)" : theme.backgroundSelected, opacity: HOVER_DIM },
      ]}
    >
      {preview.image && (
        <Image source={{ uri: preview.image }} style={styles.image} contentFit="cover" />
      )}
      <View style={styles.body}>
        {preview.title && (
          <Text numberOfLines={2} style={[styles.title, { color: textColor }]}>
            {preview.title}
          </Text>
        )}
        {preview.description && (
          <Text numberOfLines={2} style={[styles.description, { color: secondary }]}>
            {preview.description}
          </Text>
        )}
        <Text numberOfLines={1} style={[styles.site, { color: secondary }]}>
          {(preview.siteName ?? new URL(url).hostname).toUpperCase()}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    borderRadius: Radii.input,
    overflow: "hidden",
    maxWidth: 280,
  },
  image: {
    width: "100%",
    height: 130,
  },
  body: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  title: {
    fontSize: Type.secondary,
    fontWeight: "600",
  },
  description: {
    fontSize: 12,
    marginTop: 1,
  },
  site: {
    fontSize: 10,
    marginTop: 3,
  },
});
