use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};

const SOURCE_SHA: &str = env!("COMMA_SOURCE_SHA");
static ACTIVATION_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopShellIdentity {
    source_sha: String,
    semver: String,
    bundle_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellReleaseState {
    running_sha: String,
    staged_sha: Option<String>,
}

fn app_bundle_path() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    executable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .filter(|path| path.extension().is_some_and(|extension| extension == "app"))
        .ok_or_else(|| "Comma is not running from an app bundle".to_owned())
}

fn plist_value(app: &Path, key: &str) -> Result<String, String> {
    let plist = app.join("Contents/Info.plist");
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", &format!("Print :{key}")])
        .arg(plist)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("missing {key} in Comma Info.plist"));
    }
    String::from_utf8(output.stdout)
        .map(|value| value.trim().to_owned())
        .map_err(|error| error.to_string())
}

fn identity_from_bundle(app: &Path) -> Result<DesktopShellIdentity, String> {
    Ok(DesktopShellIdentity {
        source_sha: plist_value(app, "CommaSourceSHA")?,
        semver: plist_value(app, "CFBundleShortVersionString")?,
        bundle_id: plist_value(app, "CFBundleIdentifier")?,
    })
}

#[tauri::command]
fn desktop_shell_identity(app: AppHandle) -> DesktopShellIdentity {
    DesktopShellIdentity {
        source_sha: SOURCE_SHA.to_owned(),
        semver: app.package_info().version.to_string(),
        bundle_id: app.config().identifier.clone(),
    }
}

#[tauri::command]
fn staged_desktop_shell() -> Result<Option<DesktopShellIdentity>, String> {
    let staged = PathBuf::from(format!("{}.staged", app_bundle_path()?.display()));
    if !staged.is_dir() {
        return Ok(None);
    }
    identity_from_bundle(&staged).map(Some)
}

#[tauri::command]
fn get_shell_release_state() -> Result<ShellReleaseState, String> {
    Ok(ShellReleaseState {
        running_sha: SOURCE_SHA.to_owned(),
        staged_sha: staged_desktop_shell()?.map(|identity| identity.source_sha),
    })
}

fn start_staged_desktop_activation(
    app: AppHandle,
    expected_source_sha: &str,
) -> Result<(), String> {
    let app_bundle = app_bundle_path()?;
    let staged_bundle = PathBuf::from(format!("{}.staged", app_bundle.display()));
    let staged_identity = identity_from_bundle(&staged_bundle)?;
    if staged_identity.source_sha != expected_source_sha {
        return Err("staged shell SHA does not match expectedSourceSha".to_owned());
    }
    if staged_identity.bundle_id != app.config().identifier {
        return Err("staged shell bundle ID does not match Comma".to_owned());
    }

    let helper = app
        .path()
        .resolve("bin/desktop-activate.sh", BaseDirectory::Resource)
        .map_err(|error| error.to_string())?;
    if !helper.is_file() {
        return Err("Comma activation helper is missing".to_owned());
    }

    let pid = std::process::id().to_string();
    let ready_file = std::env::temp_dir().join(format!("comma-activation-{pid}.ready"));
    let _ = fs::remove_file(&ready_file);
    let mut child = Command::new("/usr/bin/nohup")
        .arg("/bin/zsh")
        .arg("-c")
        .arg("unset PROCID PROCID_REF PROCID_OFF; exec -a comma:activator /bin/bash \"$@\"")
        .arg("comma:activator")
        .arg(helper)
        .args(["--app", &app_bundle.display().to_string()])
        .args(["--expected-sha", expected_source_sha])
        .args(["--wait-pid", &pid])
        .args(["--ready-file", &ready_file.display().to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to start Comma activator: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if ready_file.is_file() {
            let _ = fs::remove_file(&ready_file);
            break;
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("Comma activator exited before readiness: {status}"));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return Err("Comma activator did not become ready".to_owned());
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
fn activate_staged_desktop_shell(app: AppHandle, expected_source_sha: String) -> Result<(), String> {
    if expected_source_sha.len() != 40
        || !expected_source_sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("expectedSourceSha must be a full lowercase Git SHA".to_owned());
    }
    if ACTIVATION_STARTED.swap(true, Ordering::AcqRel) {
        return Err("Comma activation is already starting".to_owned());
    }
    let result = start_staged_desktop_activation(app, &expected_source_sha);
    if result.is_err() {
        ACTIVATION_STARTED.store(false, Ordering::Release);
    }
    result
}

#[tauri::command]
fn restart_to_staged_shell(app: AppHandle) -> Result<(), String> {
    let staged = staged_desktop_shell()?.ok_or_else(|| "no staged Comma update".to_owned())?;
    activate_staged_desktop_shell(app, staged.source_sha)
}

fn build_menu(app: &tauri::App) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let new_message = MenuItemBuilder::with_id("conversation.new", "New Message")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let close = MenuItemBuilder::with_id("navigation.close", "Close")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let find = MenuItemBuilder::with_id("conversation.find", "Find in Conversation")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let search = MenuItemBuilder::with_id("palette.open", "Search")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;

    let display_name = app.package_info().name.clone();
    let app_menu = SubmenuBuilder::new(app, &display_name)
        .about(Some(AboutMetadata {
            name: Some(display_name),
            ..Default::default()
        }))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&new_message)
        .separator()
        .item(&close)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let find_menu = SubmenuBuilder::new(app, "Find")
        .item(&find)
        .item(&search)
        .build()?;

    MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file)
        .item(&edit)
        .item(&find_menu)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            desktop_shell_identity,
            staged_desktop_shell,
            get_shell_release_state,
            activate_staged_desktop_shell,
            restart_to_staged_shell
        ])
        .setup(|app| {
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("main window config");
            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .initialization_script(
                    "Object.defineProperty(window,'__IMSG_NATIVE_SHELL__',{value:true,enumerable:true});",
                )
                .build()?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("imsg-shortcut", id);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
