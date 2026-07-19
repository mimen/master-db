export interface Config {
  bbUrl: string;
  bbPassword: string;
  port: number;
  dbPath: string;
}

function required(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  return {
    bbUrl: (Bun.env.BB_URL ?? "http://localhost:1234").replace(/\/$/, ""),
    bbPassword: required("BB_PASSWORD"),
    port: Number(Bun.env.PORT ?? 8377),
    dbPath: Bun.env.DB_PATH ?? "imsg.db",
  };
}
