import { parseEmbeddedWebSha, parseEntryAsset } from "./deployment/verify-core";

export async function verifyServedWeb(baseUrl: string, expectedSha: string): Promise<string> {
  if (!expectedSha.match(/^[0-9a-f]{40}$/)) throw new Error("expected SHA must be a full lowercase Git SHA");
  const rootResponse = await fetch(new URL("/", baseUrl), { signal: AbortSignal.timeout(15_000) });
  if (!rootResponse.ok) throw new Error(`production root returned HTTP ${rootResponse.status}`);
  const html = await rootResponse.text();
  if (parseEmbeddedWebSha(html) !== expectedSha) throw new Error("served HTML release SHA does not match deploy");
  const entryAsset = parseEntryAsset(html);
  const entryResponse = await fetch(new URL(entryAsset, baseUrl), { signal: AbortSignal.timeout(15_000) });
  if (!entryResponse.ok) throw new Error(`production entry asset returned HTTP ${entryResponse.status}`);
  if (!(entryResponse.headers.get("cache-control") ?? "").includes("immutable")) {
    throw new Error("production entry asset is not immutable");
  }
  if (!(await entryResponse.text()).includes(expectedSha)) {
    throw new Error("production entry asset does not embed deploy SHA");
  }
  return entryAsset;
}

if (import.meta.main) {
  const baseUrl = process.argv[2];
  const expectedSha = process.argv[3];
  if (!baseUrl || !expectedSha) throw new Error("usage: verify-served-web.ts BASE_URL EXPECTED_SHA");
  const entryAsset = await verifyServedWeb(baseUrl, expectedSha);
  console.log(`Verified served web release ${expectedSha} via ${entryAsset}`);
}
