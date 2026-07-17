import { useEffect, useState } from "react";
import type { LinkPreviewData } from "../../shared/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const previewCache = new Map<string, LinkPreviewData | null>();

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/;

export function firstUrl(text: string): string | null {
  return text.match(URL_PATTERN)?.[0] ?? null;
}

export function LinkPreviewCard({ url, mine }: { url: string; mine: boolean }) {
  const [preview, setPreview] = useState<LinkPreviewData | null | undefined>(
    previewCache.has(url) ? previewCache.get(url) : undefined,
  );

  useEffect(() => {
    if (previewCache.has(url)) return;
    let cancelled = false;
    api
      .linkPreview(url)
      .then((data) => {
        previewCache.set(url, data);
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        previewCache.set(url, null);
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mt-1.5 block max-w-72 overflow-hidden rounded-xl border text-left no-underline",
        mine ? "border-primary-foreground/20 bg-primary-foreground/10" : "bg-background",
      )}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          className="max-h-36 w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="px-2.5 py-1.5">
        {preview.title && (
          <div className="line-clamp-2 text-xs font-semibold">{preview.title}</div>
        )}
        {preview.description && (
          <div className={cn("line-clamp-2 text-[11px]", mine ? "opacity-80" : "text-muted-foreground")}>
            {preview.description}
          </div>
        )}
        <div className={cn("mt-0.5 truncate text-[10px] uppercase", mine ? "opacity-60" : "text-muted-foreground/70")}>
          {preview.siteName ?? new URL(url).hostname}
        </div>
      </div>
    </a>
  );
}
