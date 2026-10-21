import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { cacheDirectory, EncodingType, writeAsStringAsync } from "expo-file-system/legacy";

import type { PendingAttachmentAsset } from "./attachments";
import { showToast } from "./toast";

/** The pickers behind the composer's + sheet, shared with the agent pane's input. */
function fromImagePicker(result: ImagePicker.ImagePickerResult): PendingAttachmentAsset[] {
  return (result.assets ?? []).map((asset) => ({
    uri: asset.uri,
    name: asset.fileName ?? `photo.${asset.uri.split(".").pop() ?? "jpg"}`,
    mime: asset.mimeType ?? "image/jpeg",
    isImage: (asset.mimeType ?? "image/jpeg").startsWith("image/"),
    cleanup: null,
  }));
}

export async function pickPhotos(): Promise<PendingAttachmentAsset[]> {
  return fromImagePicker(await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    allowsMultipleSelection: true,
    selectionLimit: 8,
    quality: 0.9,
  }));
}

export async function takePhoto(): Promise<PendingAttachmentAsset[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    showToast("Camera access is off. Allow it in Settings.");
    return [];
  }
  return fromImagePicker(await ImagePicker.launchCameraAsync({ quality: 0.9, mediaTypes: ["images", "videos"] }));
}

export async function pickFiles(): Promise<PendingAttachmentAsset[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true });
  if (result.canceled) return [];
  return (result.assets ?? []).map((asset) => ({
    uri: asset.uri,
    name: asset.name,
    mime: asset.mimeType ?? "application/octet-stream",
    isImage: (asset.mimeType ?? "").startsWith("image/"),
    cleanup: null,
  }));
}

export async function pasteNativeImage(): Promise<PendingAttachmentAsset[]> {
  try {
    const image = await Clipboard.getImageAsync({ format: "png" });
    if (!image) {
      showToast("The clipboard doesn't contain an image");
      return [];
    }
    if (!cacheDirectory) throw new Error("Expo cache directory is unavailable");
    const separator = image.data.indexOf(",");
    if (separator < 0) throw new Error("Clipboard image data is malformed");
    const filename = `clipboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
    const uri = `${cacheDirectory}${filename}`;
    await writeAsStringAsync(uri, image.data.slice(separator + 1), { encoding: EncodingType.Base64 });
    return [{ uri, name: filename, mime: "image/png", isImage: true, cleanup: "cache-file" }];
  } catch {
    showToast("Couldn't paste the image. Try copying it again.");
    return [];
  }
}
