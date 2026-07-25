export type PublicEnvResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Validates the URL Expo embeds into the client bundle at export time. */
export function validateConvexUrl(value: string | undefined): PublicEnvResult {
  const url = value?.trim() ?? "";
  if (!url) {
    return { ok: false, error: "EXPO_PUBLIC_CONVEX_URL is required" };
  }
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return {
        ok: false,
        error: "EXPO_PUBLIC_CONVEX_URL must be an absolute HTTP(S) URL",
      };
    }
  } catch {
    return {
      ok: false,
      error: "EXPO_PUBLIC_CONVEX_URL must be an absolute HTTP(S) URL",
    };
  }
  return { ok: true, value: url };
}

export function requireConvexUrl(value: string | undefined): string {
  const result = validateConvexUrl(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export function validateIdentityKey(value: string | undefined): PublicEnvResult {
  const key = value?.trim() ?? "";
  if (!key) {
    return { ok: false, error: "EXPO_PUBLIC_IMSG_IDENTITY_KEY is required" };
  }
  return { ok: true, value: key };
}

export function requireIdentityKey(value: string | undefined): string {
  const result = validateIdentityKey(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
