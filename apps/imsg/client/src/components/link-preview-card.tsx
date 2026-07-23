import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { BASE_URL } from "@/lib/config";
import { useTheme } from "@/hooks/use-theme";
import { Radii, Type } from "@/constants/theme";

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const cache = new Map<string, LinkPreviewData | null>();
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/;

export function firstUrl(text: string): string | null {
  return text.match(URL_PATTERN)?.[0] ?? null;
}

export function LinkPreviewCard({ url, mine }: { url: string; mine: boolean }) {
  const theme = useTheme();
  const [preview, setPreview] = useState<LinkPreviewData | null | undefined>(
    cache.has(url) ? cache.get(url) : undefined,
  );

  useEffect(() => {
    if (cache.has(url)) return;
    let cancelled = false;
    fetch(`${BASE_URL}/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((res) => res.json() as Promise<LinkPreviewData | null>)
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
  }, [url]);

  if (!preview) return null;

  const textColor = mine ? theme.onAccent : theme.text;
  // Dimmed white, not a solid onAccent — no token for this specific alpha.
  const secondary = mine ? "rgba(255,255,255,0.7)" : theme.textSecondary;

  return (
    <Pressable
      onPress={() => void Linking.openURL(url)}
      style={[
        styles.card,
        { backgroundColor: mine ? "rgba(255,255,255,0.14)" : theme.backgroundElement },
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
