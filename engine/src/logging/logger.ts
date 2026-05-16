type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

function serializeField(v: unknown): unknown {
  if (v instanceof Error) return { message: v.message, stack: v.stack };
  return v;
}

export function createLogger(
  opts: { sink?: (line: string) => void } = {},
): Logger {
  const sink = opts.sink ?? ((line) => process.stdout.write(line + "\n"));
  const emit = (
    level: Level,
    msg: string,
    fields: Record<string, unknown> = {},
  ) => {
    const serialized: Record<string, unknown> = {
      ts: Date.now(),
      level,
      msg,
    };
    for (const [k, v] of Object.entries(fields)) serialized[k] = serializeField(v);
    sink(JSON.stringify(serialized));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
