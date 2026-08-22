fn main() {
    println!("cargo:rerun-if-env-changed=COMMA_DEV_GUARDED");
    let debug_build = std::env::var("PROFILE").is_ok_and(|profile| profile == "debug");
    let guarded = std::env::var("COMMA_DEV_GUARDED").is_ok_and(|value| value == "1");
    if debug_build && !guarded {
        panic!("production-identical debug desktop builds are disabled; run `bun run dev:desktop` from apps/imsg");
    }
    tauri_build::build()
}
