/**
 * Vault search for contact inference. Shells to ripgrep because the vault is
 * thousands of notes and a JS walk would blow the ~2s fast-lane budget.
 */

export interface VaultHit {
  path: string;
  line: string;
}

/** Parses `rg --no-heading` output, whose format is `path:lineno:text`. */
export function parseRipgrepOutput(stdout: string, limit = 20): VaultHit[] {
  const hits: VaultHit[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    // Windows-style drive letters never occur here, so the first two colons
    // always delimit path and line number.
    const firstColon = raw.indexOf(":");
    if (firstColon < 0) continue;
    const secondColon = raw.indexOf(":", firstColon + 1);
    if (secondColon < 0) continue;
    hits.push({ path: raw.slice(0, firstColon), line: raw.slice(secondColon + 1).trim() });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function makeVaultSearch(vaultPath: string) {
  return async function search(pattern: string): Promise<VaultHit[]> {
    try {
      const proc = Bun.spawn(
        ["rg", "--no-heading", "--line-number", "--max-count", "2", "-g", "*.md", pattern, vaultPath],
        { stdout: "pipe", stderr: "ignore" },
      );
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return parseRipgrepOutput(stdout);
    } catch {
      // A missing vault or absent rg must not take down the suggestion path.
      return [];
    }
  };
}

