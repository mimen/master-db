export type FaceTimeKind = "audio" | "video";

export function faceTimeTargetUrl(address: string, kind: FaceTimeKind): string {
  const trimmed = address.trim();
  if (!trimmed) throw new Error("FaceTime address is required");
  const scheme = kind === "audio" ? "facetime-audio" : "facetime";
  return `${scheme}://${encodeURIComponent(trimmed)}`;
}

export function appleMapsLocationUrl(latitude: number, longitude: number, label = "Current Location"): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Location coordinates must be finite numbers");
  }
  const coordinates = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const params = new URLSearchParams({ ll: coordinates, q: label });
  return `https://maps.apple.com/?${params.toString()}`;
}

export function webLocationBlockReason(isSecureContext: boolean, hostname: string): string | null {
  if (isSecureContext || hostname === "localhost" || hostname === "127.0.0.1") return null;
  return "Location requires the HTTPS tailnet address; browsers block it on plain HTTP.";
}
