import { z } from "zod";

const schema = z.object({
  AGENTIC_SERVER_TOKEN: z.string().min(8),
  CONVEX_URL: z.string().url(),
  CONVEX_DEPLOY_KEY: z.string().optional(),
  PORT: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? 8787 : Number(v)))
    .pipe(z.number().int().min(1).max(65535)),
  LOG_DIR: z.string().optional().default("~/.agentic-engine/logs"),
});

export type Env = {
  token: string;
  convexUrl: string;
  convexDeployKey: string | null;
  port: number;
  logDir: string;
};

export function loadEnv(
  raw: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Env {
  const parsed = schema.parse(raw);
  return {
    token: parsed.AGENTIC_SERVER_TOKEN,
    convexUrl: parsed.CONVEX_URL,
    convexDeployKey: parsed.CONVEX_DEPLOY_KEY ?? null,
    port: parsed.PORT,
    logDir: parsed.LOG_DIR,
  };
}
