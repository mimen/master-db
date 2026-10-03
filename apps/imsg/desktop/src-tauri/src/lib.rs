use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, Url};
use tauri_plugin_opener::OpenerExt;

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

    // Match the helper's bounded lock wait, then leave a fixed verification
    // budget for codesign, plist, and architecture checks.
    let lock_wait_seconds = std::env::var("COMMA_ACTIVATION_LOCK_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value <= 60)
        .unwrap_or(15);
    let deadline = Instant::now() + Duration::from_secs(lock_wait_seconds + 20);
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
fn activate_staged_desktop_shell(
    app: AppHandle,
    expected_source_sha: String,
) -> Result<(), String> {
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

fn is_convex_signin_url(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|host| host.ends_with(".convex.site"))
        && url.path().starts_with("/api/auth/signin")
}

fn oauth_code_from_request_line(line: &str) -> Option<String> {
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/?") || parts.next()? != "HTTP/1.1" || parts.next().is_some() {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != "/" || url.fragment().is_some() {
        return None;
    }
    url.query_pairs()
        .find(|(key, value)| key == "code" && !value.is_empty())
        .map(|(_, value)| value.into_owned())
}

fn read_oauth_code(stream: &mut TcpStream, deadline: Instant) -> Option<String> {
    stream.set_nonblocking(true).ok()?;
    let mut request = [0_u8; 8192];
    let mut length = 0;
    while Instant::now() < deadline && length < request.len() {
        match stream.read(&mut request[length..]) {
            Ok(0) => return None,
            Ok(count) => {
                length += count;
                if let Some(end) = request[..length].iter().position(|byte| *byte == b'\n') {
                    return oauth_code_from_request_line(
                        std::str::from_utf8(&request[..end]).ok()?,
                    );
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
    None
}

#[tauri::command]
fn start_oauth_loopback(app: AppHandle) -> Result<u16, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;
    let origin = window.url().map_err(|error| error.to_string())?.origin();
    let mut redirect = Url::parse(&format!("{}/", origin.ascii_serialization()))
        .map_err(|error| error.to_string())?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let deadline = Instant::now() + Duration::from_secs(5 * 60);
    std::thread::Builder::new()
        .name("oauth-loopback".to_owned())
        .spawn(move || {
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let code = read_oauth_code(&mut stream, deadline);
                        let (status, message) = if code.is_some() {
                            ("200 OK", "Signed in. You can close this tab and return to Comma.")
                        } else {
                            ("400 Bad Request", "Could not sign in. Return to Comma and try again.")
                        };
                        let body = format!("<!doctype html><html><body><p>{message}</p></body></html>");
                        if stream.set_nonblocking(false).is_ok()
                            && stream.set_write_timeout(Some(Duration::from_secs(5))).is_ok()
                        {
                            let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                        }
                        if let Some(code) = code {
                            redirect.query_pairs_mut().append_pair("code", &code);
                            if let Err(error) = window.navigate(redirect) {
                                eprintln!("Could not finish OAuth navigation: {error}");
                            }
                            let _ = window.set_focus();
                        }
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(error) => {
                        eprintln!("Could not accept OAuth callback: {error}");
                        break;
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;
    Ok(port)
}

const PRODUCTION_BUNDLE_ID: &str = "com.milad.imsg.desktop";
const PRODUCTION_APP_PATH: &str = "/Users/mimen/Applications/Comma.app";

fn executable_app_bundle(executable_path: &Path) -> Option<&Path> {
    let macos = executable_path.parent()?;
    if macos.file_name()? != "MacOS" {
        return None;
    }
    let contents = macos.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    contents.parent()
}

fn production_identity_allowed(identifier: &str, executable_path: &Path) -> bool {
    identifier != PRODUCTION_BUNDLE_ID
        || executable_app_bundle(executable_path) == Some(Path::new(PRODUCTION_APP_PATH))
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
            restart_to_staged_shell,
            start_oauth_loopback
        ])
        .setup(|app| {
            let executable_path = std::env::current_exe()?;
            if !production_identity_allowed(&app.config().identifier, &executable_path) {
                return Err(std::io::Error::other(format!(
                    "production-identical desktop launch requires /Users/mimen/Applications/Comma.app: {}",
                    executable_path.display()
                ))
                .into());
            }
            let menu = build_menu(app)?;
            app.set_menu(menu)?;
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("main window config");
            let navigation_app = app.handle().clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .on_navigation(move |url| {
                    if is_convex_signin_url(url) {
                        if let Err(error) = navigation_app.opener().open_url(url.as_str(), None::<&str>) {
                            eprintln!("Could not open OAuth in the system browser: {error}");
                        }
                        return false;
                    }
                    true
                })
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

#[cfg(test)]
mod tests {
    use super::{
        is_convex_signin_url, oauth_code_from_request_line, production_identity_allowed,
        read_oauth_code, PRODUCTION_BUNDLE_ID,
    };
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::path::Path;
    use std::time::{Duration, Instant};
    use tauri::Url;

    #[test]
    fn convex_signin_opens_in_the_system_browser_only() {
        assert!(is_convex_signin_url(
            &Url::parse("https://shiny-gerbil-853.convex.site/api/auth/signin/google?redirectTo=x")
                .unwrap()
        ));
        for url in [
            "https://shiny-gerbil-853.convex.site/api/auth/callback/google",
            "https://shiny-gerbil-853.convex.site/",
            "https://shiny-gerbil-853.convex.site.evil.com/api/auth/signin/google",
            "https://evilconvex.site/api/auth/signin/google",
            "https://milads-mac-mini.taild31e9a.ts.net:8447/",
            "http://127.0.0.1:54321/?code=abc",
        ] {
            assert!(!is_convex_signin_url(&Url::parse(url).unwrap()), "{url}");
        }
    }

    #[test]
    fn oauth_request_decodes_the_code_and_reencodes_it_for_navigation() {
        let code = oauth_code_from_request_line("GET /?state=x&code=a%2Bb%26c%3Dd HTTP/1.1\r");
        assert_eq!(code.as_deref(), Some("a+b&c=d"));
        let mut redirect = Url::parse("https://example.com/").unwrap();
        redirect
            .query_pairs_mut()
            .append_pair("code", &code.unwrap());
        assert_eq!(redirect.as_str(), "https://example.com/?code=a%2Bb%26c%3Dd");
    }

    #[test]
    fn oauth_request_rejects_missing_codes_and_malformed_request_lines() {
        for line in [
            "GET / HTTP/1.1",
            "GET /?error=access_denied HTTP/1.1",
            "GET /?code= HTTP/1.1",
            "POST /?code=abc HTTP/1.1",
            "GET /elsewhere?code=abc HTTP/1.1",
            "GET /?code=abc#fragment HTTP/1.1",
            "GET /?code=abc",
            "GET /?code=abc HTTP/1.1 extra",
            "garbage",
            "",
        ] {
            assert_eq!(oauth_code_from_request_line(line), None, "{line}");
        }
    }

    #[test]
    fn oauth_socket_reads_a_request_and_bounds_a_stalled_connection() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut stream, _) = listener.accept().unwrap();
        client
            .write_all(b"GET /?code=abc HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .unwrap();
        assert_eq!(
            read_oauth_code(&mut stream, Instant::now() + Duration::from_secs(1)),
            Some("abc".to_owned())
        );
        assert_eq!(
            read_oauth_code(&mut stream, Instant::now() + Duration::from_millis(50)),
            None
        );
    }

    #[test]
    fn production_identity_requires_the_canonical_installed_app() {
        for path in [
            "/tmp/target/release/imsg-desktop",
            "/Applications/Comma.app/Contents/MacOS/imsg-desktop",
            "/Users/mimen/Programming/Repos/convex-db/apps/imsg/desktop/src-tauri/target/release/bundle/macos/Comma.app/Contents/MacOS/imsg-desktop",
        ] {
            assert!(!production_identity_allowed(PRODUCTION_BUNDLE_ID, Path::new(path)));
        }
        assert!(production_identity_allowed(
            PRODUCTION_BUNDLE_ID,
            Path::new("/Users/mimen/Applications/Comma.app/Contents/MacOS/imsg-desktop")
        ));
    }

    #[test]
    fn development_bundle_identity_can_run_unpacked() {
        assert!(production_identity_allowed(
            "com.milad.comma.dev.b123456789abc",
            Path::new("/tmp/target/debug/imsg-desktop")
        ));
    }
}
