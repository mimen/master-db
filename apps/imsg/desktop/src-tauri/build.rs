use std::path::PathBuf;
use std::process::Command;

fn git_metadata_path(path: &str) -> Option<PathBuf> {
    let output = Command::new("git")
        .args(["rev-parse", "--absolute-git-dir"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let git_dir = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    Some(PathBuf::from(git_dir).join(path))
}

fn git_source_sha() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let sha = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(sha)
}

fn main() {
    println!("cargo:rerun-if-env-changed=COMMA_SOURCE_SHA");
    if let Some(head_log) = git_metadata_path("logs/HEAD") {
        println!("cargo:rerun-if-changed={}", head_log.display());
    }
    let source_sha = std::env::var("COMMA_SOURCE_SHA")
        .ok()
        .filter(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .or_else(git_source_sha)
        .unwrap_or_else(|| "development".to_owned());
    println!("cargo:rustc-env=COMMA_SOURCE_SHA={source_sha}");

    println!("cargo:rerun-if-env-changed=COMMA_DEV_GUARDED");
    let debug_build = std::env::var("PROFILE").is_ok_and(|profile| profile == "debug");
    let guarded = std::env::var("COMMA_DEV_GUARDED").is_ok_and(|value| value == "1");
    if debug_build && !guarded {
        panic!("production-identical debug desktop builds are disabled; run `bun run dev:desktop` from apps/imsg");
    }
    tauri_build::build()
}
