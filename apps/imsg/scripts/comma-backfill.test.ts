import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

async function cli(secret: string) {
  const process = Bun.spawn([Bun.which("bun")!, "--no-env-file", fileURLToPath(new URL("./comma-backfill.ts", import.meta.url))], {
    env: { ...Bun.env, BB_PASSWORD: "test", COMMA_BRIDGE_SECRET: secret, CONVEX_SITE_URL: "", HOST: "127.0.0.1" },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
  ]);
  return { stdout, stderr, code };
}

test("CLI is inert without a bridge secret", async () => {
  const result = await cli("");
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("backfill disabled");
});

test("CLI fails before reads when site URL is missing", async () => {
  const result = await cli("test");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("CONVEX_SITE_URL is unset");
});
