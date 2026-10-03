export async function fetchAccessToken(
  baseUrl: string,
  { forceRefreshToken }: { forceRefreshToken: boolean },
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(`${baseUrl}/api/convex-token${forceRefreshToken ? "?refresh=1" : ""}`);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body !== null && typeof body === "object" && "token" in body && typeof body.token === "string"
      ? body.token : null;
  } catch {
    return null;
  }
}
