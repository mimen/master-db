import type { ConvexIngest } from "../convex-ingest";

type DeletionPage = { done: boolean; phase?: string; cursor?: string };
export async function deleteMirroredChat(ingest: Pick<ConvexIngest, "post">, chatGuid: string, signal?: AbortSignal): Promise<void> {
  // This domain's ingest kind extends the foundation's closed transport types.
  const post = ingest.post as unknown as (kind: "deleteChat", body: { chatGuid: string; phase?: string; cursor?: string }) => Promise<DeletionPage>;
  let page: DeletionPage = { done: false };
  while (!page.done) {
    signal?.throwIfAborted();
    page = await post.call(ingest, "deleteChat", { chatGuid,
      ...(page.phase ? { phase: page.phase } : {}), ...(page.cursor ? { cursor: page.cursor } : {}) });
  }
}
