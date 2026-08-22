if (Bun.env.COMMA_DEV_GUARDED !== "1") {
  console.error("Production-identical Tauri development is disabled.");
  console.error("Run the guarded canonical launcher from apps/imsg: bun run dev:desktop");
  process.exit(1);
}
