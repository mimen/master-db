import type { BBMessage } from "./bb-types";
import type { BlueBubbles, Result } from "./bluebubbles";

/** Creates a BlueBubbles FaceTime session link, then sends it through the same seam. */
export async function createAndSendFaceTimeLink(
  bb: BlueBubbles,
  chatGuid: string,
): Promise<Result<BBMessage>> {
  const link = await bb.createFaceTimeLink();
  if (!link.ok) return link;
  return bb.sendText(chatGuid, link.value);
}
