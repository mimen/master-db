import type { BlueBubbles } from "./bluebubbles";

const PHOTO_TTL_MS = 10 * 60 * 1000;

/** Resolves and caches group-chat photos, downloading the attachment on demand. */
export class GroupPhotos {
  private cache = new Map<string, { at: number; photoGuid: string | null }>();

  constructor(private bb: BlueBubbles) {}

  async photo(chatGuid: string): Promise<Response | null> {
    let cached = this.cache.get(chatGuid);
    if (!cached || Date.now() - cached.at > PHOTO_TTL_MS) {
      const chat = await this.bb.getChat(chatGuid);
      cached = {
        at: Date.now(),
        photoGuid: chat.ok ? (chat.value.properties?.[0]?.groupPhotoGuid ?? null) : null,
      };
      this.cache.set(chatGuid, cached);
    }
    const photoGuid = cached.photoGuid;
    if (!photoGuid) return null;
    const download = await this.bb.downloadAttachment(photoGuid);
    if (!download.ok || !download.body) return null;
    return new Response(download.body, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  }
}
